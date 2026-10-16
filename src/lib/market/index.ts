import { DEXSCREENER_API_BASE, JUPITER, USDC_MINT } from "@/lib/config";
import { supabaseAdmin } from "@/lib/db/client";

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

/** Harga USD token (pair dengan likuiditas terdalam; fallback Jupiter). */
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
  return null;
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
  return {
    priceUsd: top?.priceUsd ? Number(top.priceUsd) : null,
    change1h: top?.priceChange?.h1 ?? null,
    change24h: top?.priceChange?.h24 ?? null,
    liquidityUsd: top?.liquidity?.usd ?? null,
    volume24h: top?.volume?.h24 ?? null,
    fdv: top?.fdv ?? null,
    txns24h: top?.txns?.h24 ?? null,
    poolCount: pairs.length,
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
