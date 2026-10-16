import { PublicKey } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { supabaseAdmin } from "@/lib/db/client";
import { audit } from "@/lib/security/audit";
import { getWalletKeypair, refreshBalance, usdcAta } from "@/lib/solana/wallet";
import { getTreasury, sendUsdcTransfer, usdcAtaOf } from "@/lib/chain/usdc";
import { createSplToken } from "@/lib/chain/token-create";
import { uploadTokenAssets } from "@/lib/chain/assets";
import {
  createCpmmPool,
  addLiquidity as poolAddLiquidity,
  removeLiquidity as poolRemoveLiquidity,
} from "@/lib/chain/pool";
import { executeSwapToUsdc, gasDrop } from "@/lib/chain/swap";
import { getConnection } from "@/lib/solana/connection";
import { SOL_MINT, USDC_MINT, LAMPORTS_PER_SOL } from "@/lib/config";
import {
  completeJob,
  claimPendingJobs,
  failJob,
  type JobRow,
  type JobType,
} from "@/lib/jobs/queue";
import { fetchMarketSummary, saveSnapshot } from "@/lib/market";
import { rawToUsdc } from "@/lib/payment/pricing";
import { failOrder } from "@/lib/payment/orders";

type Handler = (payload: Record<string, unknown>) => Promise<void>;

function num(v: unknown): bigint {
  return BigInt(String(v ?? 0));
}

/* ───────────────── create_token ───────────────── */
async function handleCreateToken(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "confirmed") return;
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

  const owner = await getWalletKeypair(order.user_id);
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
  const supplyRaw = BigInt(Math.round(Number(cfg.supply) * 10 ** decimals));

  const result = await createSplToken({
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
  });

  await db.from("tokens").insert({
    user_id: order.user_id,
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

  const owner = await getWalletKeypair(order.user_id);
  const quoteMint = new PublicKey(cfg.quoteMint ?? USDC_MINT);
  const baseMint = new PublicKey(token.mint);
  const decimals = token.decimals as number;

  const result = await createCpmmPool({
    owner,
    baseMint,
    quoteMint,
    baseAmountRaw: BigInt(Math.round(Number(cfg.tokenAmount) * 10 ** decimals)),
    quoteAmountRaw: BigInt(
      Math.round(Number(cfg.quoteAmount) * 10 ** (quoteMint.toBase58() === USDC_MINT ? 6 : 9)),
    ),
    feeBps: cfg.feeBps ?? 25,
  });

  await db.from("pools").insert({
    user_id: order.user_id,
    token_id: cfg.tokenId,
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

  const owner = await getWalletKeypair(order.user_id);
  const res = await poolAddLiquidity({
    owner,
    poolId: pool.pool_id,
    inputAmountRaw: num(cfg.inputAmountRaw),
    baseIn: cfg.baseIn,
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

  const owner = await getWalletKeypair(order.user_id);
  const res = await poolRemoveLiquidity({
    owner,
    poolId: pool.pool_id,
    lpAmountRaw: num(cfg.lpAmountRaw),
  });
  await db
    .from("orders")
    .update({ status: "confirmed", tx_signature: res.txSignature ?? null })
    .eq("id", orderId);
}

/* ───────────────── withdraw ───────────────── */
async function handleWithdraw(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const withdrawalId = String(payload.withdrawalId);
  const { data: w } = await db.from("withdrawals").select("*").eq("id", withdrawalId).single();
  if (!w || w.status === "confirmed" || w.status === "failed") return;
  await db.from("withdrawals").update({ status: "processing" }).eq("id", withdrawalId);

  try {
    const owner = await getWalletKeypair(w.user_id);
    const destination = new PublicKey(w.destination as string);
    const sig = await sendUsdcTransfer({
      from: owner,
      toOwner: destination,
      amountRaw: BigInt(w.amount_raw as string),
      feePayer: getTreasury(),
    });
    await db
      .from("withdrawals")
      .update({ status: "confirmed", tx_signature: sig })
      .eq("id", withdrawalId);
    await db.from("wallet_events").upsert(
      {
        user_id: w.user_id,
        type: "withdrawal",
        mint: USDC_MINT,
        amount_raw: `-${w.amount_raw}`,
        signature: sig,
        meta: { destination: w.destination },
      },
      { onConflict: "user_id,signature,type,mint" },
    );
    await refreshBalance(w.user_id);
  } catch (e) {
    // Biarkan job retry; penandaan failed final dilakukan onPermanentFailure.
    throw e;
  }
}

/* ───────────────── swap ───────────────── */
async function handleSwap(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "confirmed") return;
  const cfg = order.config as { inputMint: string; amountRaw: string };

  const owner = await getWalletKeypair(order.user_id);
  await gasDrop(owner.publicKey.toBase58()); // SOL kecil untuk fee swap
  const res = await executeSwapToUsdc({
    owner,
    inputMint: cfg.inputMint,
    amountRaw: num(cfg.amountRaw),
  });
  await db.from("wallet_events").upsert(
    {
      user_id: order.user_id,
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
      const treasury = getTreasury();
      const sig = await sendUsdcTransfer({
        from: owner,
        toOwner: treasury.publicKey,
        amountRaw: feeRaw,
        feePayer: treasury,
      });
      void sig;
    }
  }

  await db
    .from("orders")
    .update({ status: "confirmed", tx_signature: res.txSignature })
    .eq("id", orderId);
  await refreshBalance(order.user_id);
}

/* ───────────────── refund ───────────────── */
async function handleRefund(payload: Record<string, unknown>): Promise<void> {
  const db = supabaseAdmin();
  const orderId = String(payload.orderId);
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status === "refunded") return;
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
  const treasury = getTreasury();
  const { data: wallet } = await db
    .from("wallets")
    .select("public_key")
    .eq("user_id", order.user_id)
    .single();
  if (!wallet) throw new Error("wallet user tidak ditemukan untuk refund");
  const sig = await sendUsdcTransfer({
    from: treasury,
    toOwner: new PublicKey(wallet.public_key),
    amountRaw: amount,
    feePayer: treasury,
  });
  await db
    .from("orders")
    .update({ status: "refunded", tx_signature: sig })
    .eq("id", orderId);
  await db.from("wallet_events").upsert(
    {
      user_id: order.user_id,
      type: "refund",
      mint: USDC_MINT,
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
  const bal = await refreshBalance(userId);
  const { data: wallet } = await db
    .from("wallets")
    .select("public_key")
    .eq("user_id", userId)
    .single();
  if (!wallet) return;

  const conn = getConnection();
  const ata = usdcAta(new PublicKey(wallet.public_key));
  const sigs = await conn.getSignaturesForAddress(ata, { limit: 25 });
  for (const s of sigs) {
    const { data: existing } = await db
      .from("wallet_events")
      .select("id")
      .eq("user_id", userId)
      .eq("signature", s.signature)
      .maybeSingle();
    if (existing) continue;
    const tx = await conn.getParsedTransaction(s.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx?.meta?.postTokenBalances) continue;
    const ownerPk = wallet.public_key;
    const post = tx.meta.postTokenBalances.find(
      (b) => b.owner === ownerPk && b.mint === USDC_MINT,
    );
    const pre = (tx.meta.preTokenBalances ?? []).find(
      (b) => b.owner === ownerPk && b.mint === USDC_MINT,
    );
    const delta = BigInt(post?.uiTokenAmount?.amount ?? "0") - BigInt(pre?.uiTokenAmount?.amount ?? "0");
    if (delta > 0n) {
      await db.from("wallet_events").upsert(
        {
          user_id: userId,
          type: "deposit",
          mint: USDC_MINT,
          amount_raw: delta.toString(),
          signature: s.signature,
          meta: {},
        },
        { onConflict: "user_id,signature,type,mint" },
      );
    }
  }
  void bal;
}

/* ───────────────── price_snapshot ───────────────── */
async function handlePriceSnapshot(): Promise<void> {
  const db = supabaseAdmin();
  const { data: tokens } = await db
    .from("tokens")
    .select("mint")
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(150);
  for (const t of tokens ?? []) {
    try {
      const summary = await fetchMarketSummary(t.mint);
      await saveSnapshot(t.mint, summary);
    } catch {
      /* satu token gagal tidak menghentikan batch */
    }
  }
}

/* ───────────────── treasury_rebalance ───────────────── */
async function handleTreasuryRebalance(): Promise<void> {
  const treasury = getTreasury();
  const conn = getConnection();
  const solBalance = await conn.getBalance(treasury.publicKey);
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
  return { done, failed };
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
