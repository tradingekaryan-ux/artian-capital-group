import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { supabaseAdmin } from "@/lib/db/client";
import { generateWalletKeypair, keypairFromEncrypted } from "@/lib/solana/keypair";
import { rpcRead } from "@/lib/solana/connection";
import { ensureProfile } from "@/lib/profiles";
import { USDC_MINT, LAMPORTS_PER_SOL } from "@/lib/config";
import type { Keypair } from "@solana/web3.js";

export interface WalletRow {
  user_id: string;
  public_key: string;
  enc_secret_key: string;
  iv: string;
  auth_tag: string;
}

/**
 * Pastikan user punya wallet. Idempoten — dipanggil saat login/registrasi.
 * 1 akun = 1 wallet (PK user_id).
 */
export async function ensureWallet(userId: string): Promise<WalletRow> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (existing) return existing as WalletRow;

  // wallets.user_id FK → profiles: profile WAJIB ada dulu (user bisa langsung
  // panggil API wallet sebelum pernah membuka dashboard).
  await ensureProfile(userId);

  const kp = generateWalletKeypair();
  const { data, error } = await db
    .from("wallets")
    .upsert(
      {
        user_id: userId,
        public_key: kp.publicKeyBase58,
        enc_secret_key: kp.encrypted.ciphertext,
        iv: kp.encrypted.iv,
        auth_tag: kp.encrypted.authTag,
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    )
    .select("*")
    .single();
  if (error) throw error;
  // bila kena race (ignoreDuplicates), baca ulang
  if (!data) {
    const { data: again } = await db
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .single();
    return again as WalletRow;
  }
  return data as WalletRow;
}

export async function getWalletKeypair(userId: string): Promise<Keypair> {
  const row = await ensureWallet(userId);
  return keypairFromEncrypted(row);
}

export async function getWalletPublicKey(userId: string): Promise<PublicKey> {
  const row = await ensureWallet(userId);
  return new PublicKey(row.public_key);
}

export function usdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), owner);
}

export interface Balances {
  usdcRaw: bigint;
  solLamports: bigint;
}

/** Baca saldo on-chain (USDC + SOL) — sumber kebenaran = chain. */
export async function readOnChainBalances(ownerBase58: string): Promise<Balances> {
  const owner = new PublicKey(ownerBase58);
  const sol = BigInt(await rpcRead((c) => c.getBalance(owner)));
  const ata = usdcAta(owner);
  // getAccountInfo dulu: null = ATA belum dibuat (saldo 0, wajar);
  // RPC total gagal melempar → JANGAN dilaporkan sebagai saldo 0.
  const acctInfo = await rpcRead((c) => c.getAccountInfo(ata));
  let usdc = 0n;
  if (acctInfo) {
    const bal = await rpcRead((c) => c.getTokenAccountBalance(ata));
    usdc = BigInt(bal.value.amount);
  }
  return { usdcRaw: usdc, solLamports: sol };
}

/** Refresh cache saldo + kembalikan nilai terbaru. */
export async function refreshBalance(userId: string) {
  const db = supabaseAdmin();
  const wallet = await ensureWallet(userId);
  const bal = await readOnChainBalances(wallet.public_key);
  await db.from("balances_cache").upsert(
    {
      user_id: userId,
      usdc_raw: bal.usdcRaw.toString(),
      sol_lamports: bal.solLamports.toString(),
      refreshed_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  return bal;
}

export async function getCachedBalance(userId: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("balances_cache")
    .select("*")
    .eq("user_id", userId)
    .single();
  return data;
}

export function solFromLamports(lamports: bigint | number): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export function shortAddress(addr: string, n = 4): string {
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}
