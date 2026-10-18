import { PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import {
  getWalletKeypair,
  refreshBalance,
  usdcAta,
  ensureWallet,
  getWalletById,
} from "@/lib/solana/wallet";
import { keypairFromEncrypted } from "@/lib/solana/keypair";
import { getTreasury, sendUsdcTransfer } from "@/lib/chain/usdc";
import { createSplToken } from "@/lib/chain/token-create";
import { uploadTokenAssets } from "@/lib/chain/assets";
import {
  createCpmmPool,
  addLiquidity as poolAddLiquidity,
  removeLiquidity as poolRemoveLiquidity,
} from "@/lib/chain/pool";
import { executeSwapToUsdc } from "@/lib/chain/swap";
import { getConnection, rpcRead } from "@/lib/solana/connection";
import { usdcMintFor, type WalletKind } from "@/lib/config";
import {
  completeJob,
  claimPendingJobs,
  failJob,
  enqueue,
  type JobRow,
  type JobType,
} from "@/lib/jobs/queue";
import { fetchMarketSummary, saveSnapshot } from "@/lib/market";
import { uiToRaw, withdrawFeeRaw } from "@/lib/payment/pricing";
import { failOrder, createAndPayOrder } from "@/lib/payment/orders";
import type { WalletRow } from "@/lib/solana/wallet";

type Handler = (payload: Record<string, unknown>) => Promise<void>;

function num(v: unknown): bigint {
  return BigInt(String(v ?? 0));
}

/** bigint raw → string desimal presisi-ekak (amount pool dihitung dari supply × LP%). */
function rawToDecimal(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const s = raw.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Jenis jaringan sebuah order: payload job → kolom order → default mainnet. */
function orderKind(order: { kind?: string | null }, payload?: Record<string, unknown>): WalletKind {
  const fromPayload = payload?.kind;
  if (fromPayload === "demo" || fromPayload === "mainnet") return fromPayload;
  return order.kind === "demo" ? "demo" : "mainnet";
}

/** Wallet pemilik order (prefer wallet_id; fallback wallet per-kind). */
async function walletForOrder(
  order: { user_id: string; wallet_id?: string | null },
  kind: WalletKind,
): Promise<WalletRow> {
  if (order.wallet_id) {
    const row = await getWalletById(String(order.wallet_id));
    if (row) return row;
  }
  return ensureWallet(order.user_id, kind);
}

/** Keypair wallet pemilik order (terdekripsi sesaat di memori server). */
async function keypairForOrder(
  order: { user_id: string; wallet_id?: string | null },
  kind: WalletKind,
): Promise<Keypair> {
  return keypairFromEncrypted(await walletForOrder(order, kind));
}

/* ───────────────── create_token ───────────────── */
async function handleCreateToken(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "confirmed") return;

  // Idempotensi: bila token utk order ini SUDAH dibuat (crash setelah insert
  // tokens sebelum order confirmed), jangan buat token kedua.
  const { data: existingToken } = await db
    .from("tokens")
    .select("mint, created_tx")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existingToken) {
    await db
      .from("orders")
      .update({ status: "confirmed", tx_signature: existingToken.created_tx ?? null })
      .eq("id", orderId);
    await chainInitialPool(order, payload);
    return;
  }
  await db.from("orders").update({ status: "processing" }).eq("id", orderId);

  const cfg = order.config as {
    name: string;
    symbol: string;
    decimals: number;
    supply: string;
    logoBase64: string;
    description?: string;
    website?: string;
    twitter?: string;
    telegram?: string;
    discord?: string;
    revokeMint?: boolean;
    revokeFreeze?: boolean;
    immutable?: boolean;
  };

  const kind = orderKind(order, payload);
  const owner = await keypairForOrder(order, kind);
  const mint = Keypair.generate();
  const { logoUri, metadataUri } = await uploadTokenAssets(order.user_id, {
    name: cfg.name,
    symbol: cfg.symbol,
    description: cfg.description,
    imageBase64: cfg.logoBase64,
    website: cfg.website,
    twitter: cfg.twitter,
    telegram: cfg.telegram,
    discord: cfg.discord,
  });

  const decimals = cfg.decimals ?? 9;
  const supplyRaw = uiToRaw(cfg.supply, decimals); // presisi eksak — tanpa Number

  const result = await createSplToken(
    {
      mint,
      owner,
      decimals,
      supplyRaw,
      metadataUri,
      name: cfg.name,
      symbol: cfg.symbol,
      revokeMintAuthority: cfg.revokeMint ?? true,
      revokeFreezeAuthority: cfg.revokeFreeze ?? true,
      immutableMetadata: cfg.immutable ?? false,
    },
    kind,
  );

  const wallet = await walletForOrder(order, kind);
  await db.from("tokens").insert({
    user_id: order.user_id,
    wallet_id: wallet.id,
    kind,
    mint: result.mint,
    order_id: orderId,
    name: cfg.name,
    symbol: cfg.symbol,
    decimals,
    supply: cfg.supply,
    logo_uri: logoUri,
    metadata_uri: metadataUri,
    description: cfg.description ?? null,
    socials: {
      website: cfg.website ?? null,
      twitter: cfg.twitter ?? null,
      telegram: cfg.telegram ?? null,
      discord: cfg.discord ?? null,
    },
    revoke_mint: cfg.revokeMint ?? true,
    revoke_freeze: cfg.revokeFreeze ?? true,
    immutable: cfg.immutable ?? false,
    status: "live",
    created_tx: result.signatures[0] ?? null,
  });

  await db
    .from("orders")
    .update({ status: "confirmed", tx_signature: result.signatures[0] ?? null })
    .eq("id", orderId);
  await audit({
    actor: order.user_id,
    action: "token_created",
    target: result.mint,
    payload: { orderId },
  });
  await chainInitialPool(order, payload);
}

/**
 * Bundling wizard: bila order create_token membawa `config.pool`, buat pool
 * SEGERA setelah token confirmed — fee pool (10 USDC) + gas di-charge di sini
 * (satu transfer terpisah, idempotencyKey per order token → tidak dobel).
 * Gagal (mis. saldo berubah) TIDAK menggagalkan token: user bisa create pool
 * manual dari halaman token.
 */
async function chainInitialPool(
  order: { id: string; user_id: string; kind?: string | null; config: unknown },
  payload?: Record<string, unknown>,
): Promise<void> {
  const cfg = order.config as {
    supply?: string;
    decimals?: number;
    pool?: { quoteAmount: string; lpPercentage: number; feeBps?: number };
    poolOrderId?: string;
  };
  if (!cfg.pool || cfg.poolOrderId || !cfg.supply) return;
  try {
    const db = supabaseAdmin();
    const { data: token } = await db
      .from("tokens")
      .select("id")
      .eq("order_id", order.id)
      .maybeSingle();
    if (!token) return;

    // tokenAmount = supply × LP% — presisi bigint, bukan Number.
    const decimals = cfg.decimals ?? 9;
    const supplyRaw = uiToRaw(cfg.supply, decimals);
    const tokenAmount = rawToDecimal((supplyRaw * BigInt(cfg.pool.lpPercentage)) / 100n, decimals);

    const kind = orderKind(order, payload);
    const { order: poolOrder, reused } = await createAndPayOrder({
      userId: order.user_id,
      service: "create_pool",
      kind,
      config: {
        tokenId: token.id,
        lpPercentage: cfg.pool.lpPercentage,
        tokenAmount,
        quoteAmount: cfg.pool.quoteAmount,
        feeBps: cfg.pool.feeBps ?? 25,
      },
      idempotencyKey: `pool-${order.id}`,
    });

    // Back-reference: UI (wizard) memantau pool dari order token.
    const { data: fresh } = await db.from("orders").select("config").eq("id", order.id).maybeSingle();
    await db
      .from("orders")
      .update({
        config: {
          ...((fresh?.config as Record<string, unknown>) ?? {}),
          poolOrderId: poolOrder.id,
        },
      })
      .eq("id", order.id);
    if (!reused) {
      await audit({
        actor: order.user_id,
        action: "pool_order_created",
        target: poolOrder.id,
        payload: { fromOrder: order.id },
      });
    }
  } catch (e) {
    console.warn("[runner] auto initial pool skipped:", e instanceof Error ? e.message : e);
  }
}

/* ───────────────── create_pool ───────────────── */
async function handleCreatePool(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "confirmed") return;

  // Idempotensi: pool utk order ini SUDAH dibuat — jangan buat pool kedua di-chain.
  const { data: existingPool } = await db
    .from("pools")
    .select("id, created_tx")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existingPool) {
    await db
      .from("orders")
      .update({ status: "confirmed", tx_signature: existingPool.created_tx ?? null })
      .eq("id", orderId);
    return;
  }
  await db.from("orders").update({ status: "processing" }).eq("id", orderId);

  const cfg = order.config as {
    tokenId: string;
    lpPercentage: number;
    tokenAmount: string;
    quoteAmount: string;
    quoteMint?: string;
    feeBps?: number;
  };
  const { data: token } = await db.from("tokens").select("*").eq("id", cfg.tokenId).single();
  if (!token) throw new Error("token not found");

  const kind = orderKind(order, payload);
  const owner = await keypairForOrder(order, kind);
  const quoteMint = new PublicKey(cfg.quoteMint ?? usdcMintFor(kind));
  const baseMint = new PublicKey(token.mint);
  const decimals = token.decimals as number;
  const quoteDecimals = quoteMint.toBase58() === usdcMintFor(kind) ? 6 : 9;

  const result = await createCpmmPool(
    {
      owner,
      baseMint,
      quoteMint,
      baseAmountRaw: uiToRaw(cfg.tokenAmount, decimals),
      quoteAmountRaw: uiToRaw(cfg.quoteAmount, quoteDecimals),
      feeBps: cfg.feeBps ?? 25,
    },
    kind,
  );

  const wallet = await walletForOrder(order, kind);
  await db.from("pools").insert({
    user_id: order.user_id,
    wallet_id: wallet.id,
    kind,
    token_id: cfg.tokenId,
    order_id: orderId,
    dex: "raydium_cpmm",
    pool_id: result.poolId,
    quote_mint: quoteMint.toBase58(),
    fee_tier: (cfg.feeBps ?? 25) / 100,
    initial_price: Number(cfg.quoteAmount) / Number(cfg.tokenAmount),
    lp_percentage: cfg.lpPercentage,
    lp_raw: result.lpMint ? "0" : "0",
    token_amount: cfg.tokenAmount,
    quote_amount: cfg.quoteAmount,
    status: "active",
    created_tx: result.txSignature ?? null,
  });

  await db
    .from("orders")
    .update({ status: "confirmed", tx_signature: result.txSignature ?? null })
    .eq("id", orderId);
}

/* ───────────────── add / remove liquidity ───────────────── */
async function handleAddLiquidity(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "confirmed") return;
  const cfg = order.config as { poolId: string; inputAmountRaw: string; baseIn: boolean };
  const { data: pool } = await db.from("pools").select("*").eq("id", cfg.poolId).single();
  if (!pool?.pool_id) throw new Error("invalid pool");

  const kind = orderKind(order, payload);
  const owner = await keypairForOrder(order, kind);
  const res = await poolAddLiquidity({
    owner,
    poolId: pool.pool_id,
    inputAmountRaw: num(cfg.inputAmountRaw),
    baseIn: cfg.baseIn,
    kind,
  });

  await db.from("pool_positions").upsert(
    {
      user_id: order.user_id,
      pool_id: cfg.poolId,
      lp_raw: res.lpAmount ?? "0",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,pool_id" },
  );
  await db
    .from("orders")
    .update({ status: "confirmed", tx_signature: res.txSignature ?? null })
    .eq("id", orderId);
}

async function handleRemoveLiquidity(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "confirmed") return;
  const cfg = order.config as { poolId: string; lpAmountRaw: string };
  const { data: pool } = await db.from("pools").select("*").eq("id", cfg.poolId).single();
  if (!pool?.pool_id) throw new Error("invalid pool");

  const kind = orderKind(order, payload);
  const owner = await keypairForOrder(order, kind);
  const res = await poolRemoveLiquidity({
    owner,
    poolId: pool.pool_id,
    lpAmountRaw: num(cfg.lpAmountRaw),
    kind,
  });
  await db
    .from("orders")
    .update({ status: "confirmed", tx_signature: res.txSignature ?? null })
    .eq("id", orderId);
}

/* ───────────────── burn / burn_earn ───────────────── */
/**
 * Bakar token milik pemilik order (BurnChecked, fee-payer = wallet user).
 * Bila saldo habis, ATA ikut ditutup (reclaim rent ke pemilik).
 * Mode `burn_earn` memberi reward poin (1 poin per token utuh yang dibakar).
 * Idempoten: signature disimpan sebelum finalisasi; retry melewati tx.
 */
async function handleBurn(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "confirmed") return;
  const cfg = order.config as {
    mint: string;
    amountRaw: string;
    decimals: number;
    mode: "burn" | "burn_earn";
  };
  const kind = orderKind(order, payload);

  let sig = order.tx_signature as string | null;
  if (!sig) {
    const owner = await keypairForOrder(order, kind);
    const { Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
    const {
      getAssociatedTokenAddressSync,
      createBurnCheckedInstruction,
      createCloseAccountInstruction,
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
    } = await import("@solana/spl-token");
    const mint = new PublicKey(cfg.mint);
    const conn = getConnection(kind);

    // Deteksi program token: coba SPL Token lalu Token-2022.
    let programId = TOKEN_PROGRAM_ID;
    let ata = getAssociatedTokenAddressSync(mint, owner.publicKey);
    let acct = await conn.getAccountInfo(ata);
    if (!acct) {
      programId = TOKEN_2022_PROGRAM_ID;
      ata = getAssociatedTokenAddressSync(mint, owner.publicKey, false, undefined, TOKEN_2022_PROGRAM_ID);
      acct = await conn.getAccountInfo(ata);
    }
    if (!acct) throw new Error("wallet does not hold this token");

    const amountRaw = BigInt(cfg.amountRaw);
    const bal = BigInt((await conn.getTokenAccountBalance(ata)).value.amount);
    if (bal < amountRaw) {
      throw new Error("token balance changed — amount exceeds current balance (failed, try again)");
    }

    const tx = new Transaction().add(
      createBurnCheckedInstruction(ata, mint, owner.publicKey, amountRaw, cfg.decimals, [], programId),
    );
    if (bal === amountRaw) {
      tx.add(createCloseAccountInstruction(ata, owner.publicKey, owner.publicKey, [], programId));
    }
    sig = await sendAndConfirmTransaction(conn, tx, [owner], { commitment: "confirmed" });
    await db.from("orders").update({ tx_signature: sig }).eq("id", orderId);
  }

  const amountUi = Number(cfg.amountRaw) / 10 ** cfg.decimals;
  const points = cfg.mode === "burn_earn" ? Math.floor(amountUi) : 0;

  // Supply berkurang bila token milik user ini (baris `tokens` di DB).
  const { data: tok } = await db
    .from("tokens")
    .select("id, user_id, supply")
    .eq("mint", cfg.mint)
    .maybeSingle();
  if (tok && tok.user_id === order.user_id) {
    await db
      .from("tokens")
      .update({ supply: Math.max(Number(tok.supply) - amountUi, 0) })
      .eq("id", tok.id);
  }

  // Ledger reward (idempoten — order_id unique).
  const { data: existingEv } = await db
    .from("burn_events")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (!existingEv) {
    await db.from("burn_events").insert({
      user_id: order.user_id,
      wallet_id: order.wallet_id ?? null,
      order_id: orderId,
      mint: cfg.mint,
      mode: cfg.mode,
      amount_raw: cfg.amountRaw,
      amount_ui: amountUi,
      points,
      tx: sig,
    });
  }

  await db.from("orders").update({ status: "confirmed", tx_signature: sig }).eq("id", orderId);
}

/* ───────────────── withdraw (hanya mainnet/live) ───────────────── */
async function handleWithdraw(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const withdrawalId = String(payload.withdrawalId);
  const { data: w } = await db.from("withdrawals").select("*").eq("id", withdrawalId).single();
  if (!w || w.status === "confirmed" || w.status === "failed") return;
  await db.from("withdrawals").update({ status: "processing" }).eq("id", withdrawalId);

  // Wallet sumber dana = yang tercatat saat request (kolom withdrawals.wallet_id),
  // fallback payload, fallback wallet mainnet tertua (data lama).
  const walletId = (payload.walletId as string | null | undefined) ?? w.wallet_id ?? null;
  const walletRow = walletId ? await getWalletById(String(walletId)) : null;
  const owner = walletRow
    ? keypairFromEncrypted(walletRow)
    : await getWalletKeypair(w.user_id, "mainnet");
  const destination = new PublicKey(w.destination as string);
  const treasury = getTreasury("mainnet");

  // 1) Fee flat → treasury (DIKUMPULKAN — sebelumnya fee tidak pernah ditarik).
  //    Gas fee tx & tx utama dibayar dari saldo SOL user (fee-payer = owner).
  //    Idempotensi: fee_tx dicatat; retry melewati langkah ini bila sudah terkirim.
  const feeRaw = await withdrawFeeRaw();
  let feeTx: string | null = w.fee_tx ?? null;
  if (feeRaw > 0n && !feeTx) {
    feeTx = await sendUsdcTransfer({
      from: owner,
      toOwner: treasury.publicKey,
      amountRaw: feeRaw,
      feePayer: owner,
      skipCreateDestAta: true, // ATA treasury pasti ada
      kind: "mainnet",
    });
    await db
      .from("withdrawals")
      .update({ fee_tx: feeTx, fee_raw: feeRaw.toString() })
      .eq("id", withdrawalId);
  }

  // 2) Jumlah utama → tujuan
  const sig = await sendUsdcTransfer({
    from: owner,
    toOwner: destination,
    amountRaw: BigInt(w.amount_raw as string),
    feePayer: owner,
    kind: "mainnet",
  });
  await db
    .from("withdrawals")
    .update({ status: "confirmed", tx_signature: sig })
    .eq("id", withdrawalId);
  await db.from("wallet_events").upsert(
    {
      user_id: w.user_id,
      wallet_id: walletRow?.id ?? null,
      kind: "mainnet",
      type: "withdrawal",
      mint: usdcMintFor("mainnet"),
      amount_raw: `-${w.amount_raw}`,
      signature: sig,
      meta: { destination: w.destination, feeTx },
    },
    { onConflict: "user_id,signature,type,mint" },
  );
  await refreshBalance(w.user_id, "mainnet", walletRow?.id);

  // Alert transaksi (slot `tx`) — WD sudah confirmed on-chain.
  const { notifyWebhook } = await import("@/lib/webhooks");
  await notifyWebhook(
    "tx",
    "transaction",
    `Withdrawal confirmed: ${(Number(w.amount_raw) / 1_000_000).toFixed(2)} USDC → ${w.destination} (tx ${sig.slice(0, 16)}…)`,
    {
      subkind: "withdrawal",
      id: withdrawalId,
      amountRaw: String(w.amount_raw),
      destination: w.destination,
      tx: sig,
      userId: w.user_id,
      kind: "mainnet",
    },
  );
}

/* ───────────────── swap (hanya mainnet/live — Jupiter tidak mendukung devnet) ───────────────── */
async function handleSwap(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "confirmed") return;
  if (order.kind === "demo") throw new Error("Swaps are not available on the demo wallet");
  const cfg = order.config as { inputMint: string; amountRaw: string };

  // Wallet aktif saat request sudah tercatat di orders.wallet_id — pakai itu
  // (bukan wallet tertua) agar konsisten dengan cek saldo di route.
  // Gas swap dari saldo SOL user (preflight di route swap); tanpa gas-drop.
  const owner = await keypairForOrder(order, "mainnet");
  const res = await executeSwapToUsdc({
    owner,
    inputMint: cfg.inputMint,
    amountRaw: num(cfg.amountRaw),
  });
  await db.from("wallet_events").upsert(
    {
      user_id: order.user_id,
      wallet_id: order.wallet_id ?? null,
      kind: "mainnet",
      type: "swap",
      mint: cfg.inputMint,
      amount_raw: `-${cfg.amountRaw}`,
      signature: res.txSignature,
      meta: { outUsdcRaw: res.outAmount },
    },
    { onConflict: "user_id,signature,type,mint" },
  );

  // Fee in-app: dipotong dari hasil swap (USDC user → treasury).
  const feeRaw = BigInt(order.amount_raw as string);
  if (feeRaw > 0n && res.outAmount) {
    const out = BigInt(res.outAmount);
    if (out > feeRaw) {
      const treasury = getTreasury("mainnet");
      const sig = await sendUsdcTransfer({
        from: owner,
        toOwner: treasury.publicKey,
        amountRaw: feeRaw,
        feePayer: owner,
        kind: "mainnet",
      });
      void sig;
    }
  }

  await db
    .from("orders")
    .update({ status: "confirmed", tx_signature: res.txSignature })
    .eq("id", orderId);
  await refreshBalance(order.user_id, "mainnet", order.wallet_id ?? undefined);
}

/* ───────────────── refund ───────────────── */
async function handleRefund(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  // Guard ketat: refund HANYA untuk order yang benar-benar gagal —
  // jangan refund order confirmed (user sudah terima barang) / sudah refunded.
  if (!order || order.status === "confirmed" || order.status === "refunded") return;
  if (!order.payment_signature) {
    // Tidak ada pembayaran → tidak ada yang perlu direfund.
    await db.from("orders").update({ status: "failed", error: order.error ?? "job failed" }).eq("id", orderId);
    return;
  }
  const amount = BigInt(order.amount_raw as string);
  if (amount <= 0n) {
    await db.from("orders").update({ status: "refunded" }).eq("id", orderId);
    return;
  }
  const kind: WalletKind = order.kind === "demo" ? "demo" : "mainnet";
  let wallet: WalletRow | null = null;
  if (order.wallet_id) {
    wallet = await getWalletById(String(order.wallet_id));
  } else {
    const { data, error } = await db
      .from("wallets")
      .select("*")
      .eq("user_id", order.user_id)
      .eq("kind", kind)
      .maybeSingle();
    if (error) throw error;
    wallet = data as WalletRow | null;
  }
  if (!wallet) throw new Error("user wallet not found for refund");
  const treasury = getTreasury(kind);
  // Gas refund dari saldo SOL user (fee-payer = user) — job refund punya
  // retry panjang (lihat queue.failJob) agar user sempat mengisi SOL bila habis.
  const userKp = keypairFromEncrypted(wallet);
  const sig = await sendUsdcTransfer({
    from: treasury,
    toOwner: new PublicKey(wallet.public_key),
    amountRaw: amount,
    feePayer: userKp,
    kind,
  });
  await db
    .from("orders")
    .update({ status: "refunded", tx_signature: sig })
    .eq("id", orderId);
  await db.from("wallet_events").upsert(
    {
      user_id: order.user_id,
      wallet_id: wallet.id ?? null,
      kind,
      type: "refund",
      mint: usdcMintFor(kind),
      amount_raw: amount.toString(),
      signature: sig,
      meta: { orderId },
    },
    { onConflict: "user_id,signature,type,mint" },
  );
}

/* ───────────────── index_wallet ───────────────── */
async function handleIndexWallet(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const userId = String(payload.userId);
  const kind: WalletKind = payload.kind === "demo" ? "demo" : "mainnet";
  await refreshBalance(userId, kind);
  const { data: wallet } = await db
    .from("wallets")
    .select("id, public_key")
    .eq("user_id", userId)
    .eq("kind", kind)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle(); // user multi-wallet → batasi 1 baris (maybeSingle tanpa limit error)
  if (!wallet) return;

  const ata = usdcAta(new PublicKey(wallet.public_key), kind);
  const usdcMint = usdcMintFor(kind);
  const sigs = await rpcRead((c) => c.getSignaturesForAddress(ata, { limit: 25 }), kind);
  for (const s of sigs) {
    const { data: existing } = await db
      .from("wallet_events")
      .select("id")
      .eq("user_id", userId)
      .eq("signature", s.signature)
      .maybeSingle();
    if (existing) continue;
    const tx = await rpcRead(
      (c) =>
        c.getParsedTransaction(s.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        }),
      kind,
    );
    if (!tx?.meta?.postTokenBalances) continue;
    const ownerPk = wallet.public_key;
    const post = tx.meta.postTokenBalances.find(
      (b) => b.owner === ownerPk && b.mint === usdcMint,
    );
    const pre = (tx.meta.preTokenBalances ?? []).find(
      (b) => b.owner === ownerPk && b.mint === usdcMint,
    );
    const delta = BigInt(post?.uiTokenAmount?.amount ?? "0") - BigInt(pre?.uiTokenAmount?.amount ?? "0");
    if (delta > 0n) {
      await db.from("wallet_events").upsert(
        {
          user_id: userId,
          wallet_id: wallet.id,
          kind,
          type: "deposit",
          mint: usdcMint,
          amount_raw: delta.toString(),
          signature: s.signature,
          meta: {},
        },
        { onConflict: "user_id,signature,type,mint" },
      );
    }
  }
}

/* ───────────────── price_snapshot (hanya mainnet — API publik) ───────────────── */
async function handlePriceSnapshot(): Promise<void> {
  const db = supabaseAdmin();
  const { data: tokens } = await db
    .from("tokens")
    .select("mint")
    .eq("status", "live")
    .eq("kind", "mainnet")
    .order("created_at", { ascending: false })
    .limit(150);
  for (const t of tokens ?? []) {
    try {
      const summary = await fetchMarketSummary(t.mint);
      await saveSnapshot(t.mint, summary);
    } catch (e) {
      console.error(`[price_snapshot] ${t.mint} failed:`, e);
      /* satu token gagal tidak menghentikan batch */
    }
  }
}

/* ───────────────── treasury_rebalance (DIMATIKAN) ───────────────── */
/** Tidak dipakai lagi: treasury tidak membayar gas (wallet user = fee-payer),
 * jadi tidak perlu mengisi float SOL. Handler dibuat no-op agar job lama aman. */
async function handleTreasuryRebalance(): Promise<void> {
  return;
}

/* ───────────────── algo_forward (retry feed → slot) ───────────────── */
/** Retry pengiriman message ke slot yang gagal saat ingest webhook. */
async function handleAlgoForward(payload: Record<string, unknown>): Promise<void> {
  const messageId = Number(payload.messageId);
  if (!Number.isFinite(messageId)) throw new Error("algo_forward: missing messageId");
  const db = supabaseAdmin();
  const { data: msg } = await db
    .from("algo_messages")
    .select("id, algo_id, payload, text")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return; // message sudah dihapus creator → selesai
  const { getAlgo, deliverToSlots } = await import("@/lib/algos");
  const algo = await getAlgo(String(msg.algo_id));
  if (!algo || !algo.is_active) return; // algo dinonaktifkan → skip
  const only = Array.isArray(payload.slotIds) ? payload.slotIds.map(String) : undefined;
  const { failed } = await deliverToSlots(
    { id: algo.id, name: algo.name },
    msg.id as number,
    msg.text as string,
    msg.payload,
    only,
  );
  if (failed.length > 0) throw new Error(`algo_forward: ${failed.length} slot masih gagal`);
}

/* ───────────────── webhook_alert (POST ke URL slot admin) ───────────────── */
/**
 * Kirim payload JSON ke URL slot (dibaca ulang dari pricing_config saat
 * eksekusi; slot di-clear → skip). Body dibentuk `buildWebhookEnvelope`:
 * {event, slot, text(+URL), content:"", url, ts, data, username, avatar_url,
 *  embeds} — Discord merender `embeds` (judul klik-able + maks3 field penting
 * + timestamp, tanpa kalimat dobel); receiver generik baca `text` & `url`.
 * Gagal (network / non-2xx) → throw → retry backoff30s×3 seperti job lain.
 */
async function handleWebhookAlert(payload: Record<string, unknown>): Promise<void> {
  const slot = String(payload.slot ?? "");
  const { WEBHOOK_SLOTS, getWebhookUrl, buildWebhookEnvelope } = await import("@/lib/webhooks");
  if (!(WEBHOOK_SLOTS as readonly string[]).includes(slot)) return; // payload rusak → selesai
  const typedSlot = slot as Parameters<typeof getWebhookUrl>[0];
  const url = await getWebhookUrl(typedSlot);
  if (!url) return; // sudah di-clear admin → skip

  const body = JSON.stringify(
    buildWebhookEnvelope({
      slot: typedSlot,
      kind: String(payload.kind ?? "alert"),
      text: String(payload.text ?? ""),
      data: (payload.data as Record<string, unknown> | undefined) ?? {},
    }),
  );

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "ArtianAlert/1.0" },
      body,
      signal: ctrl.signal,
      redirect: "manual", // redirect ke tujuan lain dianggap gagal (SSRF)
    });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/* ───────────────── user_alert_scan (siklis — deteksi user baru) ───────────────── */
/**
 * Registrasi terjadi langsung di GoTrue (signUp client-side) — tidak ada
 * hook server. Job siklis (tiap pass cron) membandingkan created_at user
 * terbaru dengan marker di pricing_config; user baru → alert slot `user`.
 * Scan PERTAMA menandai "sekarang" tanpa memberi alert (user lama tidak
 * di-spam saat fitur baru diluncurkan).
 */
async function handleUserAlertScan(): Promise<void> {
  const db = supabaseAdmin();
  const KEY = "webhook_user_scan_state";
  const now = new Date().toISOString();
  const { data: row } = await db.from("pricing_config").select("value").eq("key", KEY).maybeSingle();
  const since = (row?.value as { since?: unknown } | null)?.since;
  if (typeof since !== "string" || !since) {
    await db.from("pricing_config").upsert({ key: KEY, value: { since: now } }, { onConflict: "key" });
    return;
  }

  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const fresh = (list?.users ?? [])
    .filter((u) => (u.created_at ?? "") > since && (u.created_at ?? "") <= now)
    .sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1));
  if (!fresh.length) return;

  /**
   * Majukan marker SEBELUM mengumumkan + verifikasi tulisannya, lalu throw
   * bila gagal (job retry). Sebelumnya marker ditulis tanpa dicek SETELAH
   * pengumuman → bila tulisannya gagal, scan berikutnya mengumumkan user
   * yang sama lagi (terbukti 3× saat uji live 18 Okt). Alert bersifat
   * informatif, jadi "lebih baik kelewatan daripada dobel" dipilih di sini.
   */
  const next = fresh[fresh.length - 1].created_at;
  const { error: markErr } = await db
    .from("pricing_config")
    .upsert({ key: KEY, value: { since: next } }, { onConflict: "key" });
  if (markErr) throw new Error(`marker scan user gagal disimpan: ${markErr.message}`);
  const { data: check } = await db.from("pricing_config").select("value").eq("key", KEY).maybeSingle();
  if ((check?.value as { since?: unknown } | null)?.since !== next) {
    throw new Error("marker scan user tidak tersimpan (nilai tidak berubah)");
  }

  const { notifyWebhook } = await import("@/lib/webhooks");
  for (const u of fresh) {
    const username = (u.user_metadata as { username?: unknown } | null)?.username;
    const uname = typeof username === "string" && username ? ` (@${username})` : "";
    await notifyWebhook(
      "user",
      "user_registered",
      `New user registered: ${u.email ?? u.id}${uname}`,
      { userId: u.id, email: u.email ?? null, username: uname ? uname.slice(2, -1) : null, createdAt: u.created_at },
    );
  }
}

const handlers: Record<JobType, Handler> = {
  create_token: handleCreateToken,
  create_pool: handleCreatePool,
  add_liquidity: handleAddLiquidity,
  remove_liquidity: handleRemoveLiquidity,
  burn: handleBurn,
  withdraw: handleWithdraw,
  swap: handleSwap,
  index_wallet: handleIndexWallet,
  price_snapshot: async () => handlePriceSnapshot(),
  treasury_rebalance: async () => handleTreasuryRebalance(),
  refund: handleRefund,
  algo_forward: handleAlgoForward,
  webhook_alert: handleWebhookAlert,
  user_alert_scan: handleUserAlertScan,
};

export async function runPendingJobs(limit = 5): Promise<{ done: number; failed: number }> {
  const jobs = await claimPendingJobs(limit);
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await handlers[job.type](job.payload);
      await completeJob(job.id);
      done += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[job ${job.id} ${job.type}] failed:`, msg);
      const permanent = await failJob(job, msg);
      failed += 1;
      if (permanent) await onPermanentFailure(job, msg);
    }
  }
  // Pastikan job siklis selalu punya antrean berikutnya (production cron via
  // /api/cron/run-jobs memanggil fungsi ini — tanpa ini snapshot berhenti).
  await maybeScheduleCyclic();
  return { done, failed };
}

/** Jadwalkan job berkala (idempoten: hanya bila tidak ada job serupa pending). */
export async function maybeScheduleCyclic(): Promise<void> {
  const db = supabaseAdmin();
  // treasury_rebalance tidak lagi dijadwalkan — treasury tidak membayar gas.
  // user_alert_scan: deteksi user baru (GoTrue) tiap pass.
  for (const type of ["price_snapshot", "user_alert_scan"] as const) {
    try {
      const { data } = await db
        .from("jobs")
        .select("id")
        .eq("type", type)
        .in("status", ["pending", "running"])
        .limit(1);
      if (!data?.length) await enqueue(type, {});
    } catch (e) {
      // Contoh: constraint jobs_type_check belum ter-update (migrasi tertunda)
      // — jangan jatuhkan seluruh pass cron karena satu tipe job.
      console.error(`[cyclic] gagal jadwalkan ${type}:`, e);
    }
  }
}

/** Job habis retry → tandai order/withdrawal gagal + refund otomatis bila perlu. */
async function onPermanentFailure(job: JobRow, msg: string): Promise<void> {
  const db = supabaseAdmin();
  const orderId = job.payload.orderId ? String(job.payload.orderId) : null;
  const withdrawalId = job.payload.withdrawalId ? String(job.payload.withdrawalId) : null;
  try {
    if (orderId) await failOrder(orderId, msg);
    if (withdrawalId) {
      await db
        .from("withdrawals")
        .update({ status: "failed", error: msg })
        .eq("id", withdrawalId)
        .neq("status", "confirmed");
    }
  } catch (e) {
    console.error("[runner] onPermanentFailure failed:", e);
  }
}
