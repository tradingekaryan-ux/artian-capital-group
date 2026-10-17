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
import { USDC_MINT, USDC_DECIMALS } from "@/lib/config";

/** Kirim transfer USDC: fee payer = treasury, penandatangan = pemilik dana. */
export async function sendUsdcTransfer(params: {
  from: Keypair; // pemilik dana (user wallet atau treasury)
  toOwner: PublicKey;
  amountRaw: bigint;
  feePayer: Keypair;
  skipCreateDestAta?: boolean;
}): Promise<string> {
  const conn = getConnection();
  const mint = new PublicKey(USDC_MINT);
  const destAta = getAssociatedTokenAddressSync(mint, params.toOwner);
  const tx = new Transaction();

  if (!params.skipCreateDestAta) {
    // rpcRead: cek ATA tahan-gangguan RPC (failover ke publik cluster)
    const info = await rpcRead((c) => c.getAccountInfo(destAta));
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
    return await sendAndConfirmTransaction(conn, tx, [params.feePayer, params.from], {
      commitment: "confirmed",
    });
  } catch (e) {
    const recovered = await recoverExpiredSignature(conn, e);
    if (recovered) return recovered;
    throw e;
  }
}

export function getTreasury(): Keypair {
  const b58secret = process.env.TREASURY_SECRET_KEY;
  if (!b58secret) throw new Error("TREASURY_SECRET_KEY belum dikonfigurasi");
  return Keypair.fromSecretKey(bs58.decode(b58secret));
}

export function usdcAtaOf(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner);
}
