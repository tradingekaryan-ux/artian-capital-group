import { Connection, clusterApiUrl } from "@solana/web3.js";
import {
  RPC_URL,
  RPC_FALLBACK_URLS,
  CLUSTER,
  DEMO_RPC_URL,
  DEMO_RPC_FALLBACK_URLS,
  DEMO_CLUSTER,
  type WalletKind,
} from "@/lib/config";

interface ConnSet {
  primary: Connection;
  fallbacks: Connection[];
}

const cache = new Map<WalletKind, ConnSet>();

function connSetFor(kind: WalletKind): ConnSet {
  let set = cache.get(kind);
  if (!set) {
    const url = kind === "demo" ? DEMO_RPC_URL : RPC_URL;
    const cluster = kind === "demo" ? DEMO_CLUSTER : CLUSTER;
    const fallbacks = kind === "demo" ? DEMO_RPC_FALLBACK_URLS : RPC_FALLBACK_URLS;
    set = {
      primary: new Connection(url || clusterApiUrl(cluster), { commitment: "confirmed" }),
      fallbacks: fallbacks.map((u) => new Connection(u, { commitment: "confirmed" })),
    };
    cache.set(kind, set);
  }
  return set;
}

/** Koneksi RPC untuk jenis wallet (default = mainnet/live). */
export function getConnection(kind: WalletKind = "mainnet"): Connection {
  return connSetFor(kind).primary;
}

/**
 * RPC read dengan failover: primary → fallback publik.
 * Melempar error terakhir bila semua RPC gagal (pemanggil bisa tangani/cache).
 */
export async function rpcRead<T>(
  fn: (conn: Connection) => Promise<T>,
  kind: WalletKind = "mainnet",
): Promise<T> {
  const set = connSetFor(kind);
  let lastErr: unknown;
  for (const conn of [set.primary, ...set.fallbacks]) {
    try {
      return await fn(conn);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Priority fee yang wajar (micro-lamports CU price). */
export const PRIORITY_FEE_MICROLAMPORTS = 50_000;
