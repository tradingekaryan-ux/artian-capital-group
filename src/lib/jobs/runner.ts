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
import { getTreasury, sendUsdcTransfer, usdcAtaOf } from "@/lib/chain/usdc";
import { createSplToken } from "@/lib/chain/token-create";
import { uploadTokenAssets } from "@/lib/chain/assets";
import {
  createCpmmPool,
  addLiquidity as poolAddLiquidity,
  removeLiquidity as poolRemoveLiquidity,
} from "@/lib/chain/pool";
import { executeSwapToUsdc, gasDrop } from "@/lib/chain/swap";
import { rpcRead } from "@/lib/solana/connection";
import { SOL_MINT, usdcMintFor, LAMPORTS_PER_SOL, type WalletKind } from "@/lib/config";
import {
  completeJob,
  claimPendingJobs,
  failJob,
  enqueue,
  type JobRow,
  type JobType,
} from "@/lib/jobs/queue";
import { fetchMarketSummary, saveSnapshot } from "@/lib/market";
import { rawToUsdc, uiToRaw, withdrawFeeRaw } from "@/lib/payment/pricing";
import { failOrder } from "@/lib/payment/orders";
import type { WalletRow } from "@/lib/solana/wallet";

type Handler = (payload: Record<string, unknown>) => Promise<void>;

function num(v: unknown): bigint {
  return BigInt(String(v ?? 0));
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
  if (!token) throw new Error("token tidak ditemukan");

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
  if (!pool?.pool_id) throw new Error("pool tidak valid");

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
  if (!pool?.pool_id) throw new Error("pool tidak valid");

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
  //    Idempotensi: fee_tx dicatat; retry melewati langkah ini bila sudah terkirim.
  const feeRaw = await withdrawFeeRaw();
  let feeTx: string | null = w.fee_tx ?? null;
  if (feeRaw > 0n && !feeTx) {
    feeTx = await sendUsdcTransfer({
      from: owner,
      toOwner: treasury.publicKey,
      amountRaw: feeRaw,
      feePayer: treasury,
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
    feePayer: treasury,
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
}

/* ───────────────── swap (hanya mainnet/live — Jupiter tidak mendukung devnet) ───────────────── */
async function handleSwap(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "confirmed") return;
  if (order.kind === "demo") throw new Error("Swap tidak tersedia untuk wallet demo");
  const cfg = order.config as { inputMint: string; amountRaw: string };

  // Wallet aktif saat request sudah tercatat di orders.wallet_id — pakai itu
  // (bukan wallet tertua) agar konsisten dengan cek saldo di route.
  const owner = await keypairForOrder(order, "mainnet");
  await gasDrop(owner.publicKey.toBase58(), 2_000_000, "mainnet"); // SOL kecil untuk fee swap
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
        feePayer: treasury,
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
    await db.from("orders").update({ status: "failed", error: order.error ?? "job gagal" }).eq("id", orderId);
    return;
  }
  const amount = BigInt(order.amount_raw as string);
  if (amount <= 0n) {
    await db.from("orders").update({ status: "refunded" }).eq("id", orderId);
    return;
  }
  const kind: WalletKind = order.kind === "demo" ? "demo" : "mainnet";
  let wallet: { id: string; public_key: string } | null = null;
  if (order.wallet_id) {
    wallet = await getWalletById(String(order.wallet_id));
  } else {
    const { data: row, error } = await db
      .from("wallets")
      .select("id, public_key")
      .eq("user_id", order.user_id)
      .eq("kind", kind)
      .maybeSingle();
    if (error) throw error;
    wallet = row;
  }
  if (!wallet) throw new Error("wallet user tidak ditemukan untuk refund");
  const treasury = getTreasury(kind);
  const sig = await sendUsdcTransfer({
    from: treasury,
    toOwner: new PublicKey(wallet.public_key),
    amountRaw: amount,
    feePayer: treasury,
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
      console.error(`[price_snapshot] ${t.mint} gagal:`, e);
      /* satu token gagal tidak menghentikan batch */
    }
  }
}

/* ───────────────── treasury_rebalance ───────────────── */
async function handleTreasuryRebalance(): Promise<void> {
  const treasury = getTreasury();
  const solBalance = await rpcRead((c) => c.getBalance(treasury.publicKey));
  const warn = 0.3 * LAMPORTS_PER_SOL;
  if (solBalance >= warn) return;
  // tukar 5 USDC milik treasury → SOL (fee payer = treasury sendiri, masih ada SOL sisa)
  const target = 1.0 * LAMPORTS_PER_SOL;
  const deficitLamports = target - solBalance;
  const solPriceUsd = 150; // perkiraan konservatif; idealnya dari price API
  const usdcNeeded = Math.ceil((deficitLamports / LAMPORTS_PER_SOL) * solPriceUsd * 10 ** 6);
  await gasDrop(treasury.publicKey.toBase58(), deficitLamports);
  void usdcNeeded;
  void rawToUsdc;
}

const handlers: Record<JobType, Handler> = {
  create_token: handleCreateToken,
  create_pool: handleCreatePool,
  add_liquidity: handleAddLiquidity,
  remove_liquidity: handleRemoveLiquidity,
  withdraw: handleWithdraw,
  swap: handleSwap,
  index_wallet: handleIndexWallet,
  price_snapshot: async () => handlePriceSnapshot(),
  treasury_rebalance: async () => handleTreasuryRebalance(),
  refund: handleRefund,
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
      console.error(`[job ${job.id} ${job.type}] gagal:`, msg);
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
  for (const type of ["price_snapshot", "treasury_rebalance"] as const) {
    const { data } = await db
      .from("jobs")
      .select("id")
      .eq("type", type)
      .in("status", ["pending", "running"])
      .limit(1);
    if (!data?.length) await enqueue(type, {});
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
    console.error("[runner] onPermanentFailure gagal:", e);
  }
}

export { usdcAtaOf, SOL_MINT };
