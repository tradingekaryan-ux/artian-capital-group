import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import { getConnection, rpcRead } from "@/lib/solana/connection";
import { recoverExpiredSignature } from "@/lib/chain/confirm";
import { usdcMintFor, USDC_DECIMALS, SECRETS, type WalletKind } from "@/lib/config";

/**
 * Kirim transfer USDC. Model gas: fee-payer = wallet user (dibebankan ke user);
 * `feePayer` bisa sama dengan `from` (disederhanakan jadi satu signer).
 * `from` = pemilik dana (user wallet, atau treasury untuk refund).
 */
export async function sendUsdcTransfer(params: {
  from: Keypair; // pemilik dana (user wallet atau treasury)
  toOwner: PublicKey;
  amountRaw: bigint;
  feePayer: Keypair;
  skipCreateDestAta?: boolean;
  kind?: WalletKind; // default mainnet/live; demo = USDC devnet
}): Promise<string> {
  const kind = params.kind ?? "mainnet";
  const conn = getConnection(kind);
  const mint = new PublicKey(usdcMintFor(kind));
  const destAta = getAssociatedTokenAddressSync(mint, params.toOwner);
  const tx = new Transaction();

  if (!params.skipCreateDestAta) {
    // rpcRead: cek ATA tahan-gangguan RPC (failover ke publik cluster)
    const info = await rpcRead((c) => c.getAccountInfo(destAta), kind);
    if (!info) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          params.feePayer.publicKey,
          destAta,
          params.toOwner,
          mint,
        ),
      );
    }
  }
  tx.add(
    createTransferCheckedInstruction(
      getAssociatedTokenAddressSync(mint, params.from.publicKey),
      mint,
      destAta,
      params.from.publicKey,
      params.amountRaw,
      USDC_DECIMALS,
    ),
  );

  try {
    const sameSigner = params.feePayer.publicKey.equals(params.from.publicKey);
    const signers = sameSigner ? [params.feePayer] : [params.feePayer, params.from];
    return await sendAndConfirmTransaction(conn, tx, signers, {
      commitment: "confirmed",
    });
  } catch (e) {
    const recovered = await recoverExpiredSignature(conn, e);
    if (recovered) return recovered;
    throw e;
  }
}

/**
 * Treasury platform (penerima fee USDC; kunci dipakai untuk refund).
 * TIDAK didanai operator — treasury tidak membayar gas (wallet user = fee-payer
 * semua transaksi), jadi tidak perlu airdrop SOL ke treasury.
 * Wallet demo memakai TREASURY_SECRET_KEY_DEMO bila diset, selain itu fallback
 * ke TREASURY_SECRET_KEY.
 */
export function getTreasury(kind: WalletKind = "mainnet"): Keypair {
  if (kind === "demo") {
    const b58 = SECRETS.treasuryKeyDemo || SECRETS.treasuryKey;
    if (!b58) throw new Error("TREASURY_SECRET_KEY(_DEMO) is not configured");
    return Keypair.fromSecretKey(bs58.decode(b58));
  }
  const b58secret = SECRETS.treasuryKey;
  if (!b58secret) throw new Error("TREASURY_SECRET_KEY is not configured");
  return Keypair.fromSecretKey(bs58.decode(b58secret));
}

export function usdcAtaOf(owner: PublicKey, kind: WalletKind = "mainnet"): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(usdcMintFor(kind)), owner);
}
