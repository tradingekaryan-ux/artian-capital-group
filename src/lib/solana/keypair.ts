import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import {
  decryptSecret,
  encryptSecret,
  secretKeyBytes,
} from "@/lib/security/crypto";

export interface NewKeypair {
  publicKeyBase58: string;
  encrypted: { ciphertext: string; iv: string; authTag: string };
}

/** Hasilkan keypair baru untuk wallet kustodial user. */
export function generateWalletKeypair(): NewKeypair {
  const kp = Keypair.generate();
  return {
    publicKeyBase58: kp.publicKey.toBase58(),
    encrypted: encryptSecret(bs58.encode(kp.secretKey)),
  };
}

/** Dekripsi keypair user dari row `wallets`. Hanya dipanggil di server. */
export function keypairFromEncrypted(row: {
  enc_secret_key: string;
  iv: string;
  auth_tag: string;
}): Keypair {
  const secretB58 = decryptSecret({
    ciphertext: row.enc_secret_key,
    iv: row.iv,
    authTag: row.auth_tag,
  });
  const secret = secretKeyBytes(secretB58);
  return Keypair.fromSecretKey(secret);
}
