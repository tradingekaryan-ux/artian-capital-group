import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { supabaseAdmin } from "@/lib/db/client";
import { generateWalletKeypair, keypairFromEncrypted } from "@/lib/solana/keypair";
import { rpcRead } from "@/lib/solana/connection";
import { ensureProfile } from "@/lib/profiles";
import { normalizeWalletLabel } from "@/lib/wallet-label";
import { usdcMintFor, LAMPORTS_PER_SOL, type WalletKind } from "@/lib/config";
import type { Keypair } from "@solana/web3.js";

export interface WalletRow {
  id: string;
  user_id: string;
  kind: WalletKind;
  label: string | null;
  public_key: string;
  enc_secret_key: string;
  iv: string;
  auth_tag: string;
  created_at?: string;
  archived_at?: string | null;
}

const SELECT_WALLET = "id, user_id, kind, label, public_key, enc_secret_key, iv, auth_tag, created_at, archived_at";

async function insertWallet(
  userId: string,
  kind: WalletKind,
  label: string | null,
): Promise<WalletRow> {
  const db = supabaseAdmin();
  const kp = generateWalletKeypair();
  const { data, error } = await db
    .from("wallets")
    .insert({
      user_id: userId,
      kind,
      label,
      public_key: kp.publicKeyBase58,
      enc_secret_key: kp.encrypted.ciphertext,
      iv: kp.encrypted.iv,
      auth_tag: kp.encrypted.authTag,
    })
    .select(SELECT_WALLET)
    .single();
  if (error) throw error;

  // Alert (slot `wallet`) — wallet baru (mainnet ataupun demo/devnet).
  const { notifyWebhook } = await import("@/lib/webhooks");
  await notifyWebhook(
    "wallet",
    "wallet_created",
    `New ${kind} wallet created: ${kp.publicKeyBase58}`,
    { userId, kind, publicKey: kp.publicKeyBase58, label },
  );

  return data as WalletRow;
}

/**
 * Pastikan user punya wallet mainnet (minimal satu). Idempoten — dipanggil
 * saat login/registrasi. User bisa membuat wallet mainnet tambahan via
 * `createMainnetWallet`.
 */
export async function ensureWallet(
  userId: string,
  kind: WalletKind = "mainnet",
): Promise<WalletRow> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("wallets")
    .select(SELECT_WALLET)
    .eq("user_id", userId)
    .eq("kind", kind)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as WalletRow;

  // wallets.user_id FK → profiles: profile WAJIB ada dulu (user bisa langsung
  // panggil API wallet sebelum pernah membuka dashboard).
  await ensureProfile(userId);

  try {
    return await insertWallet(userId, kind, null);
  } catch (e) {
    // Race: baris demo baru saja dibuat user lain-request (partial unique demo).
    const { data: again } = await db
      .from("wallets")
      .select(SELECT_WALLET)
      .eq("user_id", userId)
      .eq("kind", kind)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (again) return again as WalletRow;
    throw e;
  }
}

/** Buat wallet mainnet BARU (berlabel) — bebas banyak per user. */
export async function createMainnetWallet(userId: string, label?: string): Promise<WalletRow> {
  await ensureProfile(userId);
  const db = supabaseAdmin();
  const { count } = await db
    .from("wallets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "mainnet");
  // Label dikosongkan/dibatalkan user → nama otomatis "Wallet 1", "Wallet 2", …
  const finalLabel = normalizeWalletLabel(label) || `Wallet ${(count ?? 0) + 1}`;
  return insertWallet(userId, "mainnet", finalLabel);
}

/** Buat wallet demo (maks 1 per user aktif). Bila sudah ada (non-arsip), kembalikan existing. */
export async function createDemoWallet(userId: string): Promise<WalletRow> {
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("wallets")
    .select(SELECT_WALLET)
    .eq("user_id", userId)
    .eq("kind", "demo")
    .is("archived_at", null)
    .maybeSingle();
  if (existing) return existing as WalletRow;
  await ensureProfile(userId);
  try {
    return await insertWallet(userId, "demo", "Demo (Devnet)");
  } catch (e) {
    const { data: again } = await db
      .from("wallets")
      .select(SELECT_WALLET)
      .eq("user_id", userId)
      .eq("kind", "demo")
      .is("archived_at", null)
      .maybeSingle();
    if (again) return again as WalletRow;
    throw e;
  }
}

/** Daftar semua wallet user aktif (non-arsip; mainnet dulu, lalu demo). */
export async function listWallets(userId: string): Promise<WalletRow[]> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("wallets")
    .select(SELECT_WALLET)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("kind", { ascending: true }) // 'demo' < 'mainnet' — dibalik di bawah
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as WalletRow[];
  return rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "mainnet" ? -1 : 1));
}

/** Daftar SEMUA wallet user termasuk yang diarsipkan (untuk admin). */
export async function listAllWallets(userId: string): Promise<WalletRow[]> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("wallets")
    .select(SELECT_WALLET)
    .eq("user_id", userId)
    .order("kind", { ascending: true })
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as WalletRow[];
  return rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "mainnet" ? -1 : 1));
}

/**
 * Arsipkan wallet (soft-delete). Wallet yang diarsipkan hilang dari tampilan
 * user & tidak bisa jadi wallet aktif; tetap terlihat di panel admin.
 * Wallet AKTIF tidak bisa diarsipkan — switch dulu ke wallet lain.
 * Melempar error bila wallet bukan milik userId, sudah diarsipkan, atau aktif.
 */
export async function archiveWallet(userId: string, walletId: string): Promise<WalletRow> {
  const db = supabaseAdmin();
  const { data: row } = await db
    .from("wallets")
    .select(SELECT_WALLET)
    .eq("id", walletId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) throw new Error("Wallet not found");
  if ((row as WalletRow).archived_at) throw new Error("Already archived");
  // Wallet AKTIF tidak boleh diarsipkan. Resolusi aktif = getActiveWallet()
  // (cookie `wid` bila valid, selain itu mainnet pertama) — cek langsung di
  // sini karena cookie bisa absen (fallback aktif ≠ "cookie === walletId").
  const active = await getActiveWallet(userId);
  if (active.id === walletId) {
    throw new Error("Cannot archive the active wallet — switch to another wallet first.");
  }
  const { data: updated, error } = await db
    .from("wallets")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", walletId)
    .select(SELECT_WALLET)
    .single();
  if (error) throw error;
  return updated as WalletRow;
}

/**
 * Ganti nama (label) wallet milik userId — dipakai PATCH /api/wallet/[id].
 * Label dinormalisasi (trim/kontrol/batas40) — kosong → "Label required".
 * Wallet terarsip boleh diganti namanya (masih terlihat di panel admin).
 */
export async function renameWallet(userId: string, walletId: string, label: string): Promise<WalletRow> {
  const next = normalizeWalletLabel(label);
  if (!next) throw new Error("Label required");
  const db = supabaseAdmin();
  const { data: row } = await db
    .from("wallets")
    .select("id")
    .eq("id", walletId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) throw new Error("Wallet not found");
  const { data: updated, error } = await db
    .from("wallets")
    .update({ label: next })
    .eq("id", walletId)
    .select(SELECT_WALLET)
    .single();
  if (error) throw error;
  return updated as WalletRow;
}

export async function getWalletById(walletId: string): Promise<WalletRow | null> {
  const { data } = await supabaseAdmin()
    .from("wallets")
    .select(SELECT_WALLET)
    .eq("id", walletId)
    .maybeSingle();
  return (data as WalletRow) ?? null;
}

export async function getWalletKeypair(
  userId: string,
  kind: WalletKind = "mainnet",
): Promise<Keypair> {
  const row = await ensureWallet(userId, kind);
  return keypairFromEncrypted(row);
}

export async function getWalletPublicKey(
  userId: string,
  kind: WalletKind = "mainnet",
): Promise<PublicKey> {
  const row = await ensureWallet(userId, kind);
  return new PublicKey(row.public_key);
}

export function usdcAta(owner: PublicKey, kind: WalletKind = "mainnet"): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(usdcMintFor(kind)), owner);
}

export interface Balances {
  usdcRaw: bigint;
  solLamports: bigint;
}

/** Baca saldo on-chain (USDC + SOL) — sumber kebenaran = chain. */
export async function readOnChainBalances(
  ownerBase58: string,
  kind: WalletKind = "mainnet",
): Promise<Balances> {
  const owner = new PublicKey(ownerBase58);
  const sol = BigInt(await rpcRead((c) => c.getBalance(owner), kind));
  const ata = usdcAta(owner, kind);
  // getAccountInfo dulu: null = ATA belum dibuat (saldo 0, wajar);
  // RPC total gagal melempar → JANGAN dilaporkan sebagai saldo 0.
  const acctInfo = await rpcRead((c) => c.getAccountInfo(ata), kind);
  let usdc = 0n;
  if (acctInfo) {
    const bal = await rpcRead((c) => c.getTokenAccountBalance(ata), kind);
    usdc = BigInt(bal.value.amount);
  }
  return { usdcRaw: usdc, solLamports: sol };
}

/** Refresh cache saldo per wallet + kembalikan nilai terbaru. */
export async function refreshBalance(
  userId: string,
  kind: WalletKind = "mainnet",
  walletId?: string,
) {
  const db = supabaseAdmin();
  const wallet = walletId ? await getWalletById(walletId) : null;
  const row = wallet && wallet.user_id === userId ? wallet : await ensureWallet(userId, kind);
  const bal = await readOnChainBalances(row.public_key, row.kind);
  await db.from("balances_cache").upsert(
    {
      user_id: userId,
      wallet_id: row.id,
      usdc_raw: bal.usdcRaw.toString(),
      sol_lamports: bal.solLamports.toString(),
      refreshed_at: new Date().toISOString(),
    },
    { onConflict: "wallet_id" },
  );
  return bal;
}

export async function getCachedBalance(walletId: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("balances_cache")
    .select("*")
    .eq("wallet_id", walletId)
    .maybeSingle();
  return data;
}

export function solFromLamports(lamports: bigint | number): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

export function shortAddress(addr: string, n = 4): string {
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

/* ────────── wallet aktif (cookie `wid`) ────────── */

export const ACTIVE_WALLET_COOKIE = "wid";

/**
 * Wallet aktif user: cookie `wid` bila valid & milik user, selain itu wallet
 * mainnet pertama (auto-create bila belum ada).
 */
export async function getActiveWallet(userId: string): Promise<WalletRow> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const wid = store.get(ACTIVE_WALLET_COOKIE)?.value;
  if (wid) {
    const row = await getWalletById(wid);
    // Wallet terarsip tidak valid sebagai aktif (cookie basi lintas-device).
    if (row && row.user_id === userId && !row.archived_at) return row;
  }
  return ensureWallet(userId, "mainnet");
}
