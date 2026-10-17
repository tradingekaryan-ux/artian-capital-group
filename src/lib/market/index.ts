import { DEXSCREENER_API_BASE, JUPITER, USDC_MINT, USDC_DECIMALS } from "@/lib/config";
import { supabaseAdmin } from "@/lib/db/client";

/**
 * Harga dari reserves pool Raydium on-chain — fallback untuk token yang tidak
 * ter-index DexScreener/Jupiter (token devnet). Dipanggil dinamis agar SDK
 * Raydium tidak ikut ter-bundle ke modul lain.
 */
async function fetchOnChainPoolSummary(
  mint: string,
): Promise<Pick<MarketSummary, "priceUsd" | "liquidityUsd" | "fdv" | "poolCount"> | null> {
  try {
    const db = supabaseAdmin();
    const { data: pool } = await db
      .from("pools")
      .select("pool_id, tokens!inner(decimals, supply)")
      .eq("status", "active")
      .eq("kind", "mainnet")
      .eq("tokens.mint", mint)
      .limit(1)
      .maybeSingle();
    if (!pool?.pool_id) return null;
    const { fetchPoolInfo } = await import("@/lib/chain/pool");
    const info = await fetchPoolInfo(pool.pool_id);
    if (!info) return null;
    const token = pool.tokens as unknown as { decimals: number; supply: string | number };
    // mintA/mintB bisa terbalik — pastikan sisi quote = USDC sebelum hitung harga
    const baseIsToken = info.baseMint === mint;
    const quoteIsUsdc = baseIsToken ? info.quoteMint === USDC_MINT : info.baseMint === USDC_MINT;
    if (!quoteIsUsdc) return null;
    const baseRaw = Number(baseIsToken ? info.baseReserve : info.quoteReserve);
    const quoteRaw = Number(baseIsToken ? info.quoteReserve : info.baseReserve);
    if (!Number.isFinite(baseRaw) || !Number.isFinite(quoteRaw) || baseRaw <= 0 || quoteRaw <= 0) {
      return null;
    }
    const baseUi = baseRaw / 10 ** token.decimals;
    const quoteUi = quoteRaw / 10 ** USDC_DECIMALS;
    const priceUsd = quoteUi / baseUi;
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
    // tokens.supply disimpan dalam unit UI (lihat handleCreateToken: supply: cfg.supply)
    const supplyUi = Number(token.supply);
    return {
      priceUsd,
      liquidityUsd: quoteUi * 2,
      fdv: supplyUi > 0 ? priceUsd * supplyUi : null,
      poolCount: 1,
    };
  } catch {
    return null;
  }
}

export interface DexTokenPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { h24?: number; h6?: number; h1?: number };
  fdv?: number;
  marketCap?: number;
  txns?: { h24?: { buys: number; sells: number } };
  pairCreatedAt?: number;
}

/** Ambil pasangan DEX untuk satu token (DexScreener, gratis). */
export async function fetchDexPairs(mint: string): Promise<DexTokenPair[]> {
  const res = await fetch(
    `${DEXSCREENER_API_BASE}/tokens/v1/solana/${encodeURIComponent(mint)}`,
    { next: { revalidate: 15 } },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? (data as DexTokenPair[]) : [];
}

/** Harga USD token (pair dengan likuiditas terdalam; fallback Jupiter → on-chain pool). */
export async function fetchTokenPriceUsd(mint: string): Promise<number | null> {
  if (mint === USDC_MINT) return 1;
  const pairs = await fetchDexPairs(mint);
  const best = pairs
    .filter((p) => p.priceUsd)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (best?.priceUsd) return Number(best.priceUsd);
  try {
    const url = `${JUPITER.apiBase}/price/v3?ids=${encodeURIComponent(mint)}`;
    const res = await fetch(url, { headers: JUPITER.apiKey ? { "x-api-key": JUPITER.apiKey } : {} });
    if (res.ok) {
      const json = (await res.json()) as Record<string, { usdPrice?: number }>;
      const p = json[mint]?.usdPrice;
      if (typeof p === "number") return p;
    }
  } catch {
    /* fallback gagal */
  }
  const onchain = await fetchOnChainPoolSummary(mint);
  return onchain?.priceUsd ?? null;
}

export interface MarketSummary {
  priceUsd: number | null;
  change1h: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  fdv: number | null;
  txns24h: { buys: number; sells: number } | null;
  poolCount: number;
}

export async function fetchMarketSummary(mint: string): Promise<MarketSummary> {
  const pairs = await fetchDexPairs(mint);
  const sorted = [...pairs].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  );
  const top = sorted[0];
  if (top?.priceUsd) {
    return {
      priceUsd: Number(top.priceUsd),
      change1h: top.priceChange?.h1 ?? null,
      change24h: top.priceChange?.h24 ?? null,
      liquidityUsd: top.liquidity?.usd ?? null,
      volume24h: top.volume?.h24 ?? null,
      fdv: top.fdv ?? null,
      txns24h: top.txns?.h24 ?? null,
      poolCount: pairs.length,
    };
  }
  // token devnet / tak ter-index: harga dari reserves pool on-chain
  const onchain = await fetchOnChainPoolSummary(mint);
  return {
    priceUsd: onchain?.priceUsd ?? null,
    change1h: null,
    change24h: null,
    liquidityUsd: onchain?.liquidityUsd ?? null,
    volume24h: null,
    fdv: onchain?.fdv ?? null,
    txns24h: null,
    poolCount: onchain?.poolCount ?? pairs.length,
  };
}

/** Simpan snapshot harga (dipanggil cron tiap menit). */
export async function saveSnapshot(mint: string, summary: MarketSummary): Promise<void> {
  if (summary.priceUsd === null) return;
  await supabaseAdmin().from("price_snapshots").upsert(
    {
      mint,
      ts: new Date().toISOString(),
      price_usd: summary.priceUsd,
      liquidity_usd: summary.liquidityUsd,
      volume_24h_usd: summary.volume24h,
      fdv_usd: summary.fdv,
    },
    { onConflict: "mint,ts" },
  );
}

/** Riwayat harga untuk chart (batas 30 hari, downsample). */
export async function fetchPriceHistory(mint: string, hours: number) {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data } = await supabaseAdmin()
    .from("price_snapshots")
    .select("ts, price_usd")
    .eq("mint", mint)
    .gte("ts", since)
    .order("ts", { ascending: true })
    .limit(2000);
  return data ?? [];
}
