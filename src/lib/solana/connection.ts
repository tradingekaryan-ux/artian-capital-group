import { Connection, clusterApiUrl } from "@solana/web3.js";
import { RPC_URL, RPC_FALLBACK_URLS, CLUSTER } from "@/lib/config";

let _conn: Connection | null = null;
let _fallbacks: Connection[] | null = null;

export function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(RPC_URL || clusterApiUrl(CLUSTER), {
      commitment: "confirmed",
    });
  }
  return _conn;
}

function fallbackConnections(): Connection[] {
  if (!_fallbacks) {
    _fallbacks = RPC_FALLBACK_URLS.map(
      (u) => new Connection(u, { commitment: "confirmed" }),
    );
  }
  return _fallbacks;
}

/**
 * RPC read dengan failover: primary → fallback publik.
 * Melempar error terakhir bila semua RPC gagal (pemanggil bisa tangani/cache).
 */
export async function rpcRead<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (const conn of [getConnection(), ...fallbackConnections()]) {
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
