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

/* ───────────── Envelope payload (teks biasa utk Discord) ───────────── */

/**
 * Bentuk body POST. **Tanpa embed** — `content` berupa teks biasa yang MEMUAT
 * URL mentah, sehingga Discord mendeteksi link-nya sendiri lalu membuat
 * *website card* (preview otomatis dari og-meta halaman tujuan).
 *
 * Catatan format: URL ditulis polos (bukan `[label](url)` / `<url>`) —
 * Discord TIDAK membuka kartu untuk link yang dibungkus markdown/angle bracket.
 */
export interface WebhookEnvelope {
  event: string;
  slot: string;
  /** Pesan utk receiver generik (n8n/Zapier/postman) — identik dengan `content`. */
  text: string;
  /** Teks yang dikirim ke Discord (tanpa embed) — link dideteksi → website card. */
  content: string;
  /** URL utama utk receiver generik (events = post; tx = explorer; lainnya = halaman situs). */
  url: string;
  ts: string;
  data: Record<string, unknown>;
  /** Nama pengirim di Discord (tampil di atas pesan). */
  username: string;
  avatar_url: string;
  /** Selalu kosong — tampilan memakai teks biasa, bukan embed. */
  embeds: [];
}

/** Nama pengirim per slot. */
const SLOT_USERNAME: Record<WebhookSlot, string> = {
  events: "Artian · Event Tracker",
  tx: "Artian · Transactions",
  wallet: "Artian · Wallets",
  algo: "Artian · Algos",
  user: "Artian · Users",
  token: "Artian · Tokens",
};

/** Jenis transaksi (berdasar `data.subkind`) → label pendek utk baris judul. */
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

/**
 * `?cluster=` link explorer — `demo` (dompet latihan) selalu devnet;
 * sisanya mengikuti cluster situs (`NEXT_PUBLIC_SOLANA_CLUSTER`).
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
 * URL utama alert — diisi sebagai field `url` top-level utk receiver generik.
 * Events memakai URL post eksternal (yang dipantau komunitas), tx memakai
 * link explorer, slot lain halaman situs. (Discord memakai URL di dalam teks.)
 */
function primaryUrl(slot: WebhookSlot, data: Record<string, unknown>): string {
  const base = siteBase();
  const ext = raw(data, "url");
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
      const sig = str("tx") || str("sig");
      return sig ? explorerTxUrl(sig, str("kind")) : `${base}/admin`;
    }
  }
}

/** Batas konten Discord 2000 char. */
const CONTENT_LIMIT = 1900;

/** Signature base58 → `3yS7Qm9…YwZxCvBnHp` (alamat/tanda tangan tetap utuh di `data`). */
function short(value: string): string {
  if (/^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(value)) return `${value.slice(0, 8)}…${value.slice(-6)}`;
  return value.length > 40 ? `${value.slice(0, 39)}…` : value;
}

/** Jenis (mainnet/devnet) utk wallet & token — `demo` = dompet latihan devnet. */
function kindLabel(kind: string): string {
  return kind === "demo" ? "devnet" : "mainnet";
}

/**
 * Pesan tampilan per slot — **teks biasa baris per baris** (tanpa embed),
 * URL polos di baris terakhir supaya Discord mendeteksi & membuat kartu:
 *
 *   events → "New event posted" / caption (≤280) / URL post
 *   wallet → "New wallet — mainnet" / alamat lengkap
 *   user   → "New user — @username"
 *   algo   → "New algo — <nama>" / URL halaman algo
 *   token  → "New token — <nama> (SIMBOL) · mainnet" / URL halaman token / URL mint di explorer
 *   tx     → "New Transaction — <jenis>" / tx <signature> / URL explorer
 *
 * `fallback` dipakai hanya bila data tidak cukup utk membangun pesan.
 */
function messageFor(slot: WebhookSlot, data: Record<string, unknown>, fallback: string): string {
  const str = (key: string) => raw(data, key);
  const base = siteBase();
  const lines: string[] = [];

  switch (slot) {
    case "events": {
      lines.push("New event posted");
      const caption = str("caption");
      if (caption) lines.push(caption.slice(0, 280));
      lines.push(str("url") || `${base}/events`);
      break;
    }
    case "wallet": {
      lines.push(`New wallet — ${kindLabel(str("kind"))}`);
      if (str("publicKey")) lines.push(str("publicKey"));
      break;
    }
    case "user": {
      const username = str("username");
      lines.push(`New user — ${username ? `@${username}` : str("email") || "user"}`);
      break;
    }
    case "algo": {
      lines.push(`New algo — ${str("name") || "algo baru"}`);
      lines.push(str("algoId") ? `${base}/algos/${str("algoId")}` : `${base}/algos`);
      break;
    }
    case "token": {
      const mint = str("mint");
      const name = str("name") || str("symbol") || "token baru";
      const symbol = str("symbol");
      lines.push(
        `New token — ${symbol && symbol !== name ? `${name} (${symbol})` : name} · ${kindLabel(str("kind"))}`,
      );
      if (mint) {
        lines.push(`${base}/token/${mint}`);
        lines.push(explorerAddressUrl(mint, str("kind")));
      }
      break;
    }
    case "tx": {
      lines.push(`New Transaction — ${TX_LABEL[str("subkind")] ?? "Transaction"}`);
      const sig = str("tx") || str("sig");
      if (sig) {
        lines.push(`tx ${short(sig)}`);
        lines.push(explorerTxUrl(sig, str("kind")));
      }
      break;
    }
  }

  const msg = lines.join("\n").trim();
  if (!msg) return fallback.slice(0, CONTENT_LIMIT);
  if (msg.length <= CONTENT_LIMIT) return msg;
  // Terlalu panjang → buang baris tengah, pertahankan judul + URL terakhir.
  return `${lines[0]}\n${lines[lines.length - 1]}`.slice(0, CONTENT_LIMIT);
}

/**
 * Bentuk body POST final — **tanpa embed sama sekali**:
 * - `content` = pesan teks biasa berisi URL polos → Discord mendeteksi link
 *   dan menampilkan *website card* sendiri (preview og-meta halaman tujuan).
 * - `embeds` = `[]` (tidak ada judul/field/timestamp buatan kita).
 * - `text` identik dgn `content` utk receiver generik; `url` + `data` utuh.
 */
export function buildWebhookEnvelope(input: {
  slot: WebhookSlot;
  kind: string;
  text: string;
  data?: Record<string, unknown>;
  ts?: string;
}): WebhookEnvelope {
  const data = input.data ?? {};
  const url = primaryUrl(input.slot, data);
  const content = messageFor(input.slot, data, input.text);
  const ts = input.ts ?? new Date().toISOString();

  return {
    event: input.kind,
    slot: input.slot,
    text: content,
    content,
    url,
    ts,
    data,
    username: SLOT_USERNAME[input.slot],
    avatar_url: `${siteBase()}/icon.png`,
    embeds: [],
  };
}
