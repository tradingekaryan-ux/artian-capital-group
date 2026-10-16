import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import { getConnection } from "@/lib/solana/connection";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/config";

/**
 * Instruksi transfer USDC dengan ATA tujuan dibuat bila belum ada
 * (payer pembuat ATA = `ataPayer`, biasanya treasury).
 */
export function buildUsdcTransferIx(params: {
  fromOwner: PublicKey;
  toOwner: PublicKey;
  amountRaw: bigint;
  ataPayer: PublicKey;
}): TransactionInstruction[] {
  const mint = new PublicKey(USDC_MINT);
  const source = getAssociatedTokenAddressSync(mint, params.fromOwner);
  const dest = getAssociatedTokenAddressSync(mint, params.toOwner);
  const ixs: TransactionInstruction[] = [];
  if (!params.fromOwner.equals(params.toOwner)) {
    // ATA tujuan dibuat oleh payer (treasury) bila belum ada — cek di caller
    ixs.push(
      createAssociatedTokenAccountInstruction(params.ataPayer, dest, params.toOwner, mint),
    );
  }
  ixs.push(
    createTransferCheckedInstruction(
      source,
      mint,
      dest,
      params.fromOwner,
      params.amountRaw,
      USDC_DECIMALS,
    ),
  );
  return ixs;
}

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
    const info = await conn.getAccountInfo(destAta);
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

  return sendAndConfirmTransaction(conn, tx, [params.feePayer, params.from], {
    commitment: "confirmed",
  });
}

export function getTreasury(): Keypair {
  const b58secret = process.env.TREASURY_SECRET_KEY;
  if (!b58secret) throw new Error("TREASURY_SECRET_KEY belum dikonfigurasi");
  return Keypair.fromSecretKey(bs58.decode(b58secret));
}

export function usdcAtaOf(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner);
}

export { TOKEN_PROGRAM_ID };
