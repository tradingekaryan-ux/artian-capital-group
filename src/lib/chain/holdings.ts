import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { rpcRead } from "@/lib/solana/connection";
import type { WalletKind } from "@/lib/config";

export interface TokenHolding {
  mint: string;
  /** Saldo dalam base unit (raw). */
  amountRaw: bigint;
  decimals: number;
}

/**
 * Daftar token (SPL Token + Token-2022) yang dipegang owner, saldo > 0.
 * Dipakai halaman Burn untuk memilih token yang akan dibakar.
 */
export async function listTokenHoldings(
  owner: PublicKey,
  kind: WalletKind = "mainnet",
): Promise<TokenHolding[]> {
  const out: TokenHolding[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const res = await rpcRead(
      (c) => c.getTokenAccountsByOwner(owner, { programId }, "confirmed"),
      kind,
    );
    for (const { account } of res.value) {
      const parsed = (account.data as { parsed?: { info?: Record<string, unknown> } }).parsed;
      const info = parsed?.info;
      if (!info) continue;
      const amount = String((info.tokenAmount as { amount?: string } | undefined)?.amount ?? "0");
      if (BigInt(amount) <= 0n) continue;
      out.push({
        mint: String(info.mint),
        amountRaw: BigInt(amount),
        decimals: Number((info.tokenAmount as { decimals?: number } | undefined)?.decimals ?? 0),
      });
    }
  }
  return out;
}
