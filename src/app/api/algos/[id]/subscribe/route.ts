import { NextResponse } from "next/server";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { rateLimit } from "@/lib/security/ratelimit";
import { getActiveWallet, readOnChainBalances } from "@/lib/solana/wallet";
import { keypairFromEncrypted } from "@/lib/solana/keypair";
import { getConnection, rpcRead } from "@/lib/solana/connection";
import { recoverExpiredSignature } from "@/lib/chain/confirm";
import { getTreasury } from "@/lib/chain/usdc";
import { usdcMintFor, USDC_DECIMALS } from "@/lib/config";
import { uiToRaw } from "@/lib/payment/pricing";
import {
  getAlgoCommissionRaw,
  getLatestSub,
  isSubActive,
  ALGO_SUBSCRIBE_SOL_BUFFER,
  type AlgoRow,
} from "@/lib/algos";

const MONTHLY_DAYS = 30;

/**
 * POST /api/algos/[id]/subscribe
 * - Algo FREE → subscribe instan (tanpa transaksi on-chain).
 * - Algo BERBAYAR → satu transaksi USDC dari wallet subscriber:
 *     komisi platform → treasury, sisanya → creator (gas dibayar subscriber).
 * - Renewal = bayar lagi (row baru; komisi terpotong lagi tiap pembayaran).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
  }
  const { id } = await params;

  if (!(await rateLimit(`algo-subscribe:${auth.user.id}`, 30, 3_600_000))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const db = supabaseAdmin();
  const { data: algoRaw } = await db.from("algos").select("*").eq("id", id).maybeSingle();
  if (!algoRaw) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const algo = algoRaw as AlgoRow;
  if (!algo.is_active) return NextResponse.json({ error: "Algo is inactive" }, { status: 409 });
  if (algo.user_id === auth.user.id) {
    return NextResponse.json({ error: "You cannot subscribe to your own algo." }, { status: 400 });
  }

  const existing = await getLatestSub(id, auth.user.id);
  if (isSubActive(existing)) {
    return NextResponse.json({ error: "Already subscribed." }, { status: 409 });
  }

  let priceRaw: bigint;
  let commissionRaw: bigint;
  try {
    priceRaw = uiToRaw(String(algo.price_usdc), USDC_DECIMALS);
    commissionRaw = await getAlgoCommissionRaw();
  } catch {
    return NextResponse.json({ error: "Invalid algo price" }, { status: 500 });
  }
  if (priceRaw > 0n && priceRaw <= commissionRaw) {
    return NextResponse.json(
      { error: "Algo price is below the platform commission — creator must fix the price." },
      { status: 400 },
    );
  }

  // ── FREE: subscribe instan tanpa transaksi ────────────────
  if (priceRaw === 0n) {
    const { error } = await db.from("algo_subscriptions").insert({
      algo_id: id,
      user_id: auth.user.id,
      status: "active",
      billing: "lifetime",
      price_raw: "0",
      commission_raw: "0",
    });
    if (error) return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
    await audit({ actor: auth.user.id, action: "algo_subscribed", target: id, payload: { free: true } });
    return NextResponse.json({ ok: true, free: true });
  }

  // ── PAID: split on-chain USDC (komisi → treasury, sisanya → creator) ──
  let wallet;
  try {
    wallet = await getActiveWallet(auth.user.id);
  } catch {
    return NextResponse.json({ error: "No active wallet." }, { status: 400 });
  }
  if (wallet.kind !== "mainnet") {
    return NextResponse.json(
      { error: "Subscribe requires an active mainnet wallet." },
      { status: 400 },
    );
  }

  // Wallet creator (penerima) — mainnet, belum terarsip.
  const { data: creatorWallet } = await db
    .from("wallets")
    .select("public_key")
    .eq("user_id", algo.user_id)
    .eq("kind", "mainnet")
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!creatorWallet) {
    return NextResponse.json(
      { error: "Creator cannot receive USDC yet (no active mainnet wallet)." },
      { status: 400 },
    );
  }

  // Preflight saldo (402) — USDC cukup + SOL buffer gas.
  let balances;
  try {
    balances = await readOnChainBalances(wallet.public_key, "mainnet");
  } catch {
    return NextResponse.json({ error: "Failed to read wallet balance." }, { status: 502 });
  }
  if (balances.usdcRaw < priceRaw) {
    return NextResponse.json({ error: "Insufficient USDC balance." }, { status: 402 });
  }
  const solBuffer = BigInt(Math.round(ALGO_SUBSCRIBE_SOL_BUFFER * 1e9));
  if (balances.solLamports < solBuffer) {
    return NextResponse.json({ error: "Insufficient SOL for gas." }, { status: 402 });
  }

  const signature = await sendSubscribeSplit({
    subscriberKp: keypairFromEncrypted(wallet),
    creatorOwner: new PublicKey(creatorWallet.public_key as string),
    priceRaw,
    commissionRaw,
  });

  const expiresAt =
    algo.billing === "monthly"
      ? new Date(Date.now() + MONTHLY_DAYS * 24 * 3600 * 1000).toISOString()
      : null;
  const { error } = await db.from("algo_subscriptions").insert({
    algo_id: id,
    user_id: auth.user.id,
    status: "active",
    billing: algo.billing,
    price_raw: priceRaw.toString(),
    commission_raw: commissionRaw.toString(),
    tx_signature: signature,
    expires_at: expiresAt,
  });
  if (error) {
    return NextResponse.json(
      { error: "Payment succeeded but recording failed — contact support.", signature },
      { status: 500 },
    );
  }

  await audit({
    actor: auth.user.id,
    action: "algo_subscribed",
    target: id,
    payload: {
      priceRaw: priceRaw.toString(),
      commissionRaw: commissionRaw.toString(),
      billing: algo.billing,
      signature,
    },
  });
  // Alert transaksi (slot `tx`) — langganan berbayar ter-split on-chain.
  const { notifyWebhook } = await import("@/lib/webhooks");
  await notifyWebhook(
    "tx",
    "transaction",
    `Algo subscription paid: "${algo.name}" ${(Number(algo.price_usdc)).toFixed(2)} USDC (${algo.billing}) — tx ${signature.slice(0, 16)}…`,
    {
      subkind: "algo_subscribe",
      algoId: id,
      algoName: algo.name,
      subscriberId: auth.user.id,
      billing: algo.billing,
      priceRaw: priceRaw.toString(),
      commissionRaw: commissionRaw.toString(),
      tx: signature,
    },
  );
  return NextResponse.json({ ok: true, signature, expiresAt });
}

/**
 * Satu transaksi: (opsional) buat ATA creator + treasury bila belum ada,
 * transfer komisi → treasury, transfer sisanya → creator. Fee-payer = subscriber.
 */
async function sendSubscribeSplit(params: {
  subscriberKp: Keypair;
  creatorOwner: PublicKey;
  priceRaw: bigint;
  commissionRaw: bigint;
}): Promise<string> {
  const kind = "mainnet" as const;
  const conn = getConnection(kind);
  const mint = new PublicKey(usdcMintFor(kind));
  const { subscriberKp, creatorOwner, priceRaw, commissionRaw } = params;
  const treasury = getTreasury(kind);

  const userAta = getAssociatedTokenAddressSync(mint, subscriberKp.publicKey);
  const creatorAta = getAssociatedTokenAddressSync(mint, creatorOwner);
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury.publicKey);

  const tx = new Transaction();
  for (const [ata, owner] of [
    [creatorAta, creatorOwner],
    [treasuryAta, treasury.publicKey],
  ] as const) {
    const info = await rpcRead((c) => c.getAccountInfo(ata), kind);
    if (!info) {
      tx.add(
        createAssociatedTokenAccountInstruction(subscriberKp.publicKey, ata, owner, mint),
      );
    }
  }
  const rest = priceRaw - commissionRaw;
  if (commissionRaw > 0n) {
    tx.add(
      createTransferCheckedInstruction(
        userAta,
        mint,
        treasuryAta,
        subscriberKp.publicKey,
        commissionRaw,
        USDC_DECIMALS,
      ),
    );
  }
  tx.add(
    createTransferCheckedInstruction(
      userAta,
      mint,
      creatorAta,
      subscriberKp.publicKey,
      rest,
      USDC_DECIMALS,
    ),
  );

  try {
    return await sendAndConfirmTransaction(conn, tx, [subscriberKp], {
      commitment: "confirmed",
    });
  } catch (e) {
    const recovered = await recoverExpiredSignature(conn, e);
    if (recovered) return recovered;
    throw e;
  }
}
