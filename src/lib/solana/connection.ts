import { Connection, clusterApiUrl } from "@solana/web3.js";
import { RPC_URL, CLUSTER } from "@/lib/config";

let _conn: Connection | null = null;

export function getConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(RPC_URL || clusterApiUrl(CLUSTER), {
      commitment: "confirmed",
    });
  }
  return _conn;
}

/** Priority fee yang wajar (micro-lamports CU price). */
export const PRIORITY_FEE_MICROLAMPORTS = 50_000;
