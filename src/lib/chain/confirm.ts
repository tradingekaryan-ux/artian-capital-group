import type { Connection } from "@solana/web3.js";

/**
 * Di edge runtime (Cloudflare Workers) konfirmasi web3.js kadang melempar
 * `TransactionExpiredBlockheightExceededError` padahal transaksi SUDAH masuk
 * ledger (race antara cek block height dan konfirmasi node).
 *
 * Sebelum menganggap gagal, cek ulang status signature di chain.
 * @returns signature bila ternyata transaksi sukses, null kalau benar-benar tidak masuk.
 */
export async function recoverExpiredSignature(
  conn: Connection,
  err: unknown,
): Promise<string | null> {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (!/expired|block height exceeded/i.test(msg)) return null;
  const sig = /Signature\s+([1-9A-HJ-NP-Za-km-z]{64,100})/.exec(msg)?.[1];
  if (!sig) return null;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
      const s = r.value[0];
      if (s?.err) return null; // masuk ledger tapi gagal → biarkan error asli
      if (s && s.confirmationStatus !== "processed") return sig; // confirmed/finalized
    } catch {
      // RPC transient → coba lagi
    }
    await new Promise((res) => setTimeout(res, 1_200));
  }
  return null;
}
