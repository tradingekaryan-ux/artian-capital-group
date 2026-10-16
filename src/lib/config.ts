/** Konfigurasi terpusat — semua env dibaca di sini. */

export type Cluster = "devnet" | "mainnet-beta";

/**
 * Baca env dengan aman: nilai kosong/whitespace dianggap tidak diset
 * (JS `??` TIDAK fallback untuk string kosong — jebakan `FOO=` di .env).
 */
function envOr(key: string, fallback: string): string {
  const v = process.env[key]?.trim();
  return v ? v : fallback;
}

export const SITE = {
  name: envOr("NEXT_PUBLIC_SITE_NAME", "Artian Capital Group"),
  url: envOr("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
};

export const CLUSTER: Cluster = envOr("NEXT_PUBLIC_SOLANA_CLUSTER", "devnet") as Cluster;

export const IS_MAINNET = CLUSTER === "mainnet-beta";

export const USDC_MINT = envOr(
  "USDC_MINT",
  IS_MAINNET
    ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

export const SOL_MINT = "So11111111111111111111111111111111111111112"; // wSOL

export const USDC_DECIMALS = 6;
export const LAMPORTS_PER_SOL = 1_000_000_000;

function defaultRpc(): string {
  if (process.env.NEXT_PUBLIC_RPC_URL) return process.env.NEXT_PUBLIC_RPC_URL;
  if (process.env.HELIUS_API_KEY)
    return IS_MAINNET
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  return IS_MAINNET
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";
}

export const RPC_URL = defaultRpc();

export const JUPITER = {
  apiBase: envOr("JUPITER_API_BASE", "https://lite-api.jup.ag"),
  apiKey: process.env.JUPITER_API_KEY ?? "",
};

export const DEXSCREENER_API_BASE =
  process.env.DEXSCREENER_API_BASE ?? "https://api.dexscreener.com";

export const SECRETS = {
  treasuryKey: process.env.TREASURY_SECRET_KEY ?? "",
  walletMasterKey: process.env.WALLET_MASTER_KEY ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
};

export const SUPABASE = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

/** Batas anti-abuse (rate limit per-IP, in-memory per instance). */
export const LIMITS = {
  registerPerHour: 5,
  orderPerHour: 20,
  withdrawPerHour: 10,
  commentPerMinute: 3,
};
