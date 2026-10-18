import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { getTreasury } from "@/lib/chain/usdc";
import { getConnection } from "@/lib/solana/connection";
import { LAMPORTS_PER_SOL } from "@/lib/config";
import { getActiveWallet, readOnChainBalances } from "@/lib/solana/wallet";
import { keypairFromEncrypted } from "@/lib/solana/keypair";
import { uiToRaw } from "@/lib/payment/pricing";
import { audit } from "@/lib/security/audit";
import { rateLimit, clientIp } from "@/lib/security/ratelimit";
import type { Keypair, PublicKey, Transaction } from "@solana/web3.js";

/** Batas nominal per transaksi (guard railing; saldo tetap dicek on-chain). */
const MAX_USDC = 50_000;
const MAX_SOL = 1_000;
/** Buffer gas minimum yang harus tersisa di sumber (SOL). */
const GAS_BUFFER_LAMPORTS = 10_000_000n; // 0.01 SOL

const bodySchema = z.object({
  action: z.enum(["deposit", "withdraw"]),
  asset: z.enum(["usdc", "sol"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Invalid amount"),
});

async function safeReadBalances(ownerBase58: string) {
  try {
    return await readOnChainBalances(ownerBase58, "mainnet");
  } catch {
    return null;
  }
}

/**
 * GET /api/admin/treasury
 * Saldo real-time on-chain: treasury + wallet aktif admin (mainnet).
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const t = getTreasury("mainnet");
    const [tBal, wallet] = await Promise.all([
      safeReadBalances(t.publicKey.toBase58()),
      getActiveWallet(admin.id).catch(() => null),
    ]);
    const wBal = wallet && wallet.kind === "mainnet" ? await safeReadBalances(wallet.public_key) : null;

    return NextResponse.json({
      address: t.publicKey.toBase58(),
      sol: tBal ? Number(tBal.solLamports) / LAMPORTS_PER_SOL : 0,
      usdc: tBal ? Number(tBal.usdcRaw) / 1_000_000 : 0,
      solLamports: tBal ? tBal.solLamports.toString() : "0",
      usdcRaw: tBal ? tBal.usdcRaw.toString() : "0",
      wallet: wallet
        ? {
            address: wallet.public_key,
            kind: wallet.kind,
            sol: wBal ? Number(wBal.solLamports) / LAMPORTS_PER_SOL : 0,
            usdc: wBal ? Number(wBal.usdcRaw) / 1_000_000 : 0,
          }
        : null,
    });
  } catch (e) {
    console.error("[treasury] GET failed:", e);
    return NextResponse.json({ error: "Failed to fetch treasury balance" }, { status: 500 });
  }
}

/**
 * POST /api/admin/treasury
 * body: { action: "deposit"|"withdraw", asset: "usdc"|"sol", amount: string }
 * - deposit : wallet aktif admin (mainnet) → treasury. Gas dibayar wallet admin.
 * - withdraw: treasury → wallet aktif admin (mainnet). Gas dibayar treasury
 *   (treasury wajib punya SOL — kalau tidak, deposit SOL dulu).
 * Tujuan SELALU wallet aktif admin — ditentukan server, bukan input klien.
 * Rate limit: 5x/menit, fail-closed (saat DB down, request DITOLAK).
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!(await rateLimit(`admin-treasury:${admin.id}`, 5, 60_000, { failOpen: false }))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Validation failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { action, asset } = parsed.data;

  // Nominal → raw base-unit (presisi string; hindari float).
  let amountRaw: bigint;
  try {
    amountRaw = uiToRaw(parsed.data.amount, asset === "usdc" ? 6 : 9);
  } catch {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }
  if (amountRaw <= 0n) {
    return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });
  }
  const maxRaw = uiToRaw(asset === "usdc" ? String(MAX_USDC) : String(MAX_SOL), asset === "usdc" ? 6 : 9);
  if (amountRaw > maxRaw) {
    return NextResponse.json(
      { error: `Amount exceeds limit (${MAX_USDC} USDC / ${MAX_SOL} SOL per transaction)` },
      { status: 400 },
    );
  }

  // Wallet aktif admin = SATU-SATUNYA tujuan (withdraw) / sumber (deposit).
  const wallet = await getActiveWallet(admin.id).catch(() => null);
  if (!wallet || wallet.kind !== "mainnet") {
    return NextResponse.json(
      { error: "Switch to a mainnet wallet first (treasury transfers are mainnet-only)." },
      { status: 400 },
    );
  }

  try {
    const treasury = getTreasury("mainnet");
    const { sendUsdcTransfer } = await import("@/lib/chain/usdc");
    const { PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } = await import(
      "@solana/web3.js"
    );

    let source: Keypair;
    let destOwner: PublicKey;
    let feePayer: Keypair;
    let sig: string;

    if (action === "deposit") {
      // Sumber: wallet aktif admin → tujuan: treasury (hardcoded).
      const bal = await readOnChainBalances(wallet.public_key, "mainnet");
      if (asset === "usdc") {
        if (bal.usdcRaw < amountRaw) {
          return NextResponse.json({ error: "Insufficient USDC in your active wallet." }, { status: 400 });
        }
        if (bal.solLamports < GAS_BUFFER_LAMPORTS) {
          return NextResponse.json({ error: "Insufficient SOL in your active wallet for gas (need ~0.01 SOL)." }, { status: 400 });
        }
      } else {
        if (bal.solLamports < amountRaw + GAS_BUFFER_LAMPORTS) {
          return NextResponse.json({ error: "Insufficient SOL in your active wallet (amount + ~0.01 SOL gas)." }, { status: 400 });
        }
      }
      source = keypairFromEncrypted(wallet);
      destOwner = treasury.publicKey;
      feePayer = source;
    } else {
      // Sumber: treasury → tujuan: wallet aktif admin (hardcoded).
      const bal = await readOnChainBalances(treasury.publicKey.toBase58(), "mainnet");
      if (asset === "usdc") {
        if (bal.usdcRaw < amountRaw) {
          return NextResponse.json({ error: "Insufficient USDC in treasury." }, { status: 400 });
        }
        if (bal.solLamports < GAS_BUFFER_LAMPORTS) {
          return NextResponse.json(
            { error: "Treasury has insufficient SOL for gas — deposit SOL to treasury first." },
            { status: 400 },
          );
        }
      } else {
        if (bal.solLamports < amountRaw + GAS_BUFFER_LAMPORTS) {
          return NextResponse.json(
            { error: "Treasury has insufficient SOL (amount + ~0.01 SOL gas) — deposit SOL first." },
            { status: 400 },
          );
        }
      }
      source = treasury;
      destOwner = new PublicKey(wallet.public_key);
      feePayer = source;
    }

    if (asset === "usdc") {
      sig = await sendUsdcTransfer({
        from: source,
        feePayer,
        toOwner: destOwner,
        amountRaw,
        kind: "mainnet",
      });
    } else {
      const conn = getConnection("mainnet");
      const tx: Transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: source.publicKey,
          toPubkey: destOwner,
          lamports: Number(amountRaw),
        }),
      );
      sig = await sendAndConfirmTransaction(conn, tx, [feePayer], { commitment: "confirmed" });
    }

    const amountUi = asset === "usdc" ? Number(amountRaw) / 1_000_000 : Number(amountRaw) / LAMPORTS_PER_SOL;
    await audit({
      actor: admin.id,
      action: action === "deposit" ? "treasury_deposit" : "treasury_withdraw",
      target: action === "deposit" ? treasury.publicKey.toBase58() : wallet.public_key,
      payload: { asset, amount: amountUi, sig },
      ip: clientIp(req),
    });

    return NextResponse.json({ ok: true, sig, asset, amount: amountUi });
  } catch (e) {
    console.error(`[treasury] ${action} failed:`, e);
    return NextResponse.json({ error: "Transfer failed — check balances and try again." }, { status: 500 });
  }
}
