import crypto from "node:crypto";
import bs58 from "bs58";
import { SECRETS } from "@/lib/config";

/**
 * Enkripsi private key user (AES-256-GCM).
 * Master key hanya ada di environment/secret manager — tidak pernah di repo.
 */
function masterKey(): Buffer {
  const b64 = SECRETS.walletMasterKey;
  if (!b64) throw new Error("WALLET_MASTER_KEY belum dikonfigurasi");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("WALLET_MASTER_KEY harus 32 bytes base64");
  return key;
}

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

export function encryptSecret(secretBase58: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(secretBase58, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(e: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(e.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(e.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(e.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Hash ringkas untuk OTP / idempotensi (bukan untuk password). */
export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Konversi secret key base58 → byte array untuk signer. */
export function secretKeyBytes(base58Secret: string): Uint8Array {
  return bs58.decode(base58Secret);
}
