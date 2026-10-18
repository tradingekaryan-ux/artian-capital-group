import { supabaseAdmin } from "@/lib/db/client";
import { SITE, CLUSTER } from "@/lib/config";
import { enqueue } from "@/lib/jobs/queue";

/**
 * Webhook alert komunitas —6 slot URL terpisah, dikonfigurasi admin di
 * `/api/admin/webhooks` (disimpan di `pricing_config`, value {url}).
 *
 * Slot:
 *   events — post baru di Event Tracker (kebutuhan pengelolaan komunitas)
 *   tx     — setiap transaksi (order dibayar, WD confirmed, langganan algo,
 *            treasury, topup/withdraw admin)
 *   wallet — wallet baru (mainnet / devnet-demo)
 *   algo   — algo baru dipublikasikan
 *   user   — user baru terdaftar (dideteksi job siklis user_alert_scan)
 *   token  — token baru selesai dibuat on-chain (job create_token)
 *
 * Pengiriman LEWAT job queue (`webhook_alert`): retry backoff 30s×3,
 * timeout8s, URL dibaca ulang saat eksekusi (bila di-clear → skip).
 * enqueue saja saat URL slot kosong — panel job tidak dibanjiri no-op.
 */
export const WEBHOOK_SLOTS = ["events", "tx", "wallet", "algo", "user", "token"] as const;
export type WebhookSlot = (typeof WEBHOOK_SLOTS)[number];

export const WEBHOOK_KEYS: Record<WebhookSlot, string> = {
  events: "webhook_events",
  tx: "webhook_tx",
  wallet: "webhook_wallet",
  algo: "webhook_algo",
  user: "webhook_user",
  token: "webhook_token",
};

export interface WebhookConfig {
  events: string;
  tx: string;
  wallet: string;
  algo: string;
  user: string;
  token: string;
}

/** Key config invite Discord (bukan slot alert — hanya tautan tombol situs). */
export const DISCORD_KEY = "discord_invite_url";

/** URL invite Discord yang diset admin ("" = tombol Discord disembunyikan). */
export async function getDiscordInviteUrl(): Promise<string> {
  try {
    const { data } = await supabaseAdmin()
      .from("pricing_config")
      .select("value")
      .eq("key", DISCORD_KEY)
      .maybeSingle();
    const url = (data?.value as { url?: unknown } | null)?.url;
    return typeof url === "string" ? url : "";
  } catch (e) {
    console.error("[discord] gagal baca config:", e);
    return "";
  }
}

/** Baca semua URL slot ("" bila belum diset / value lama tidak valid). */
export async function getWebhookConfig(): Promise<WebhookConfig> {
  const { data } = await supabaseAdmin()
    .from("pricing_config")
    .select("key, value")
    .in("key", Object.values(WEBHOOK_KEYS));
  const out: WebhookConfig = { events: "", tx: "", wallet: "", algo: "", user: "", token: "" };
  for (const slot of WEBHOOK_SLOTS) {
    const row = (data ?? []).find((r) => r.key === WEBHOOK_KEYS[slot]);
    const url = (row?.value as { url?: unknown } | null)?.url;
    if (typeof url === "string" && url) out[slot] = url;
  }
  return out;
}

/** URL satu slot saat ini ("" = tidak diset). */
export async function getWebhookUrl(slot: WebhookSlot): Promise<string> {
  const cfg = await getWebhookConfig();
  return cfg[slot];
}

/**
 * Antrekan alert — TIDAK PERNAH melempar error (operasi utama tidak boleh
 * gagal karena webhook). Bila slot belum diset URL-nya → skip tanpa antrean.
 */
export async function notifyWebhook(
  slot: WebhookSlot,
  kind: string,
  text: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const url = await getWebhookUrl(slot);
    if (!url) return;
    await enqueue("webhook_alert", { slot, kind, text, data });
  } catch (e) {
    console.error(`[webhook] gagal antre alert slot=${slot}:`, e);
  }
}

/* ───────────── Envelope payload + styling Discord ───────────── */

export interface DiscordEmbed {
  /** Nama domain di atas judul — membuat embed terbaca sebagai "website card". */
  provider?: { name: string };
  title?: string;
  url?: string;
  description?: string;
  color?: number;
}

/**
 * Body POST ke URL slot.
 * - **Discord**: memakai `username` + `avatar_url` + `embeds` (tampilan rapi,
 *   `content` sengaja dikosongkan agar kalimat tidak dobel).
 * - **Receiver generik** (n8n/Zapier/postman): baca `text` (ringkasan + URL),
 *   `url`, dan `data` (payload mentah apa adanya).
 */
export interface WebhookEnvelope {
  event: string;
  slot: string;
  text: string;
  /** Kosong di Discord — tampilan ada di `embeds`. */
  content: string;
  url: string;
  ts: string;
  data: Record<string, unknown>;
  username: string;
  avatar_url: string;
  embeds: DiscordEmbed[];
}

/** Nama pengirim + warna embed per slot (palet brand: lime #d8ff3e + aksen). */
const SLOT_STYLE: Record<WebhookSlot, { username: string; color: number }> = {
  events: { username: "Artian · Event Tracker", color: 0x7c3aed },
  tx: { username: "Artian · Transactions", color: 0x22c55e },
  wallet: { username: "Artian · Wallets", color: 0x3b82f6 },
  algo: { username: "Artian · Algos", color: 0xd8ff3e },
  user: { username: "Artian · Users", color: 0xf59e0b },
  token: { username: "Artian · Tokens", color: 0x06b6d4 },
};

/** Jenis transaksi (berdasar `data.subkind`) → label pendek utk judul alert. */
const TX_LABEL: Record<string, string> = {
  order_paid: "Order paid",
  withdrawal: "Withdrawal confirmed",
  algo_subscribe: "Algo subscription paid",
  treasury_deposit: "Treasury deposit",
  treasury_withdraw: "Treasury withdraw",
  admin_wallet_topup: "User wallet top-up",
  admin_wallet_withdraw: "User wallet withdraw",
};

function siteBase(): string {
  return SITE.url.replace(/\/+$/, "");
}

/** Nilai primitif apa pun → string (object/array dianggap kosong). */
function raw(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  if (v === null || v === undefined || typeof v === "object") return "";
  return String(v).trim();
}

/** Domain utk provider embed (tampilan kartu website). */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return siteBase().replace(/^https?:\/\//, "");
  }
}

/**
 * `?cluster=` link explorer — `demo` (wallet/token dari dompet latihan) selalu
 * devnet; sisanya mengikuti cluster situs (`NEXT_PUBLIC_SOLANA_CLUSTER`).
 */
function clusterParam(kind: string): string {
  return kind === "demo" ? "devnet" : CLUSTER;
}

/** Link cek transaksi di jaringan Solana (explorer resmi). */
export function explorerTxUrl(signature: string, kind?: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${clusterParam(kind ?? "")}`;
}

/** Link cek akun (mint / pubkey) di jaringan Solana. */
export function explorerAddressUrl(address: string, kind?: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${clusterParam(kind ?? "")}`;
}

/**
 * URL utama alert — diisi sebagai field `url` top-level DAN disisipkan ke
 * `text` utk receiver generik. Events memakai URL post eksternal (yang
 * dipantau komunitas), tx memakai link explorer, slot lain halaman situs.
 */
function primaryUrl(slot: WebhookSlot, data: Record<string, unknown>): string {
  const base = siteBase();
  const ext = typeof data.url === "string" ? data.url.trim() : "";
  const str = (key: string) => raw(data, key);

  switch (slot) {
    case "events":
      return ext || `${base}/events`;
    case "algo":
      return str("algoId") ? `${base}/algos/${str("algoId")}` : `${base}/algos`;
    case "token":
      return str("mint") ? `${base}/token/${str("mint")}` : `${base}/dashboard/tokens`;
    case "wallet":
    case "user":
      return `${base}/admin/users`;
    case "tx": {
      // Yang dicari pembaca: bukti on-chain → langsung ke explorer.
      const sig = str("tx") || str("sig");
      return sig ? explorerTxUrl(sig, str("kind")) : `${base}/admin`;
    }
  }
}

/** Batas konten Discord 2000 char — sisakan ruang utk URL. */
const CONTENT_LIMIT = 1900;

/**
 * Sisipkan URL ke `text` utk receiver generik (n8n/Zapier/postman).
 * Discord TIDAK memakai `text`/`content` — tampilan Discord = `embeds` saja,
 * jadi kalimat ini tidak ikut tampil dobel di channel.
 */
function withUrl(text: string, url: string): string {
  if (!url) return text;
  if (text.includes(url)) return text;
  const joined = text ? `${text} — ${url}` : url;
  if (joined.length <= CONTENT_LIMIT) return joined;
  const room = Math.max(0, CONTENT_LIMIT - url.length - 4);
  return `${text.slice(0, room).trimEnd()} … ${url}`;
}

/** Signature base58 → `3yS7Qm9…YwZxCvBnHp` (alamat/tanda tangan tetap utuh di `data`). */
function short(value: string): string {
  if (/^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(value)) return `${value.slice(0, 8)}…${value.slice(-6)}`;
  return value.length > 40 ? `${value.slice(0, 39)}…` : value;
}

/** Jenis (mainnet/devnet) utk wallet & token — `demo` = dompet latihan devnet. */
function kindLabel(kind: string): string {
  return kind === "demo" ? "devnet" : "mainnet";
}

/** Tautan markdown Discord (`[label](url)`). */
function mdLink(label: string, url: string): string {
  return `[${label}](${url})`;
}

/**
 * Isi embed per slot — DIRANCANG MINIMAL sesuai permintaan (18 Okt malam):
 *   events — "website card": provider (domain) + judul link + caption saja
 *   wallet — teks: `New wallet — mainnet` + alamat lengkap
 *   user   — teks satu baris: `New user — @username`
 *   algo   — website card: provider + judul link ke halaman algo
 *   token  — website card: provider + judul link + 2 tautan (halaman token & explorer)
 *   tx     — `New Transaction — <jenis>` + signature + tautan explorer
 * Tanpa field, tanpa timestamp, tanpa footer (sengaja — jangan terlalu detail).
 */
function embedFor(slot: WebhookSlot, data: Record<string, unknown>, url: string, color: number): DiscordEmbed {
  const str = (key: string) => raw(data, key);
  const base = siteBase();

  switch (slot) {
    case "events": {
      const caption = str("caption");
      return {
        provider: { name: domainOf(url) },
        title: "New event posted",
        url,
        ...(caption ? { description: caption.slice(0, 280) } : {}),
        color,
      };
    }
    case "wallet": {
      const address = str("publicKey");
      return {
        title: `New wallet — ${kindLabel(str("kind"))}`,
        ...(address ? { description: address } : {}),
        color,
      };
    }
    case "user": {
      const username = str("username");
      const email = str("email");
      return {
        title: `New user — ${username ? `@${username}` : email || "user"}`,
        color,
      };
    }
    case "algo": {
      const name = str("name");
      return {
        provider: { name: domainOf(url) },
        title: `New algo — ${name || "algo baru"}`.slice(0, 256),
        url,
        color,
      };
    }
    case "token": {
      const name = str("name");
      const symbol = str("symbol");
      const mint = str("mint");
      const kind = kindLabel(str("kind"));
      const lines = [`${base}/token/${mint}`, mint ? explorerAddressUrl(mint, str("kind")) : ""]
        .filter(Boolean)
        .map((u, i) => mdLink(i === 0 ? "Token page" : "Mint · Solana Explorer", u));
      return {
        provider: { name: domainOf(url) },
        title: `New token — ${name || symbol || "token baru"}${symbol ? ` (${symbol})` : ""} · ${kind}`.slice(0, 256),
        url,
        ...(lines.length ? { description: lines.join("\n") } : {}),
        color,
      };
    }
    case "tx": {
      const sig = str("tx") || str("sig");
      const explorer = sig ? explorerTxUrl(sig, str("kind")) : "";
      const lines = [sig ? `tx \`${short(sig)}\`` : "", explorer ? mdLink("View on Solana Explorer", explorer) : ""]
        .filter(Boolean);
      return {
        title: `New Transaction — ${TX_LABEL[str("subkind")] ?? "Transaction"}`,
        ...(explorer ? { url: explorer } : {}),
        ...(lines.length ? { description: lines.join("\n") } : {}),
        color,
      };
    }
  }
}

/**
 * Bentuk body POST final — DIRANCANG UNTUK DISCORD LEBIH DULU:
 * - `content` = `""` → Discord menampilkan `embeds` saja (tidak ada kalimat dobel).
 * - `embeds` = SATU embed ringkas per slot (lihat `embedFor`) — tanpa field,
 *   tanpa timestamp, tanpa footer. Events & algo tampil sebagai kartu website
 *   (provider = domain, judul bisa diklik).
 * - `text` + `url` + `data` tetap utuh utk receiver generik (n8n/Zapier/postman).
 */
export function buildWebhookEnvelope(input: {
  slot: WebhookSlot;
  kind: string;
  text: string;
  data?: Record<string, unknown>;
  ts?: string;
}): WebhookEnvelope {
  const data = input.data ?? {};
  const style = SLOT_STYLE[input.slot];
  const url = primaryUrl(input.slot, data);
  const text = withUrl(input.text, url);
  const ts = input.ts ?? new Date().toISOString();

  return {
    event: input.kind,
    slot: input.slot,
    text,
    content: "",
    url,
    ts,
    data,
    username: style.username,
    avatar_url: `${siteBase()}/icon.png`,
    embeds: [embedFor(input.slot, data, url, style.color)],
  };
}
