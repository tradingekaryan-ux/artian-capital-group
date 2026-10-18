import { supabaseAdmin } from "@/lib/db/client";
import { SITE } from "@/lib/config";
import { enqueue } from "@/lib/jobs/queue";

/**
 * Webhook alert komunitas —5 slot URL terpisah, dikonfigurasi admin di
 * `/api/admin/webhooks` (disimpan di `pricing_config`, value {url}).
 *
 * Slot:
 *   events — post baru di Event Tracker (kebutuhan pengelolaan komunitas)
 *   tx     — setiap transaksi (order dibayar, WD confirmed, langganan algo,
 *            treasury, topup/withdraw admin)
 *   wallet — wallet baru (mainnet / devnet-demo)
 *   algo   — algo baru dipublikasikan
 *   user   — user baru terdaftar (dideteksi job siklis user_alert_scan)
 *
 * Pengiriman LEWAT job queue (`webhook_alert`): retry backoff 30s×3,
 * timeout8s, URL dibaca ulang saat eksekusi (bila di-clear → skip).
 * enqueue saja saat URL slot kosong — panel job tidak dibanjiri no-op.
 */
export const WEBHOOK_SLOTS = ["events", "tx", "wallet", "algo", "user"] as const;
export type WebhookSlot = (typeof WEBHOOK_SLOTS)[number];

export const WEBHOOK_KEYS: Record<WebhookSlot, string> = {
  events: "webhook_events",
  tx: "webhook_tx",
  wallet: "webhook_wallet",
  algo: "webhook_algo",
  user: "webhook_user",
};

export interface WebhookConfig {
  events: string;
  tx: string;
  wallet: string;
  algo: string;
  user: string;
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
  const out: WebhookConfig = { events: "", tx: "", wallet: "", algo: "", user: "" };
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

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

/**
 * Body POST ke URL slot — aman untuk receiver generik (postman, n8n, Zapier)
 * DAN tampil rapi di Discord (content + embeds + username + avatar).
 * `url` & `embeds` adalah field TAMBAHAN: penerima lama yang hanya membaca
 * `text`/`content` tetap berfungsi seperti sebelumnya.
 */
export interface WebhookEnvelope {
  event: string;
  slot: string;
  text: string;
  content: string;
  url: string;
  ts: string;
  data: Record<string, unknown>;
  username: string;
  avatar_url: string;
  embeds: DiscordEmbed[];
}

/** Warna embed per slot (palet brand: lime #d8ff3e + aksen). */
const SLOT_STYLE: Record<WebhookSlot, { label: string; username: string; color: number }> = {
  events: { label: "Event Tracker", username: "Artian · Event Tracker", color: 0x7c3aed },
  tx: { label: "Transactions", username: "Artian · Transactions", color: 0x22c55e },
  wallet: { label: "New wallet", username: "Artian · Wallets", color: 0x3b82f6 },
  algo: { label: "New algo", username: "Artian · Algos", color: 0xd8ff3e },
  user: { label: "New user", username: "Artian · Users", color: 0xf59e0b },
};

/** Label title embed untuk slot `tx` (berdasar `data.subkind`). */
const TX_LABEL: Record<string, string> = {
  order_paid: "Order paid",
  withdrawal: "Withdrawal confirmed",
  algo_subscribe: "Algo subscription paid",
  treasury_deposit: "Treasury deposit",
  treasury_withdraw: "Treasury withdraw",
  admin_wallet_topup: "Admin top-up user wallet",
  admin_wallet_withdraw: "Admin withdraw user wallet",
};

function siteBase(): string {
  return SITE.url.replace(/\/+$/, "");
}

/**
 * URL utama alert — disisipkan ke `text`/`content` DAN diisi sebagai field
 * `url` top-level. Events memakai URL post eksternal (yang dipantau komunitas);
 * slot lain mengarah ke halaman relevan di situs.
 */
function primaryUrl(slot: WebhookSlot, data: Record<string, unknown>): string {
  const base = siteBase();
  const ext = typeof data.url === "string" ? data.url.trim() : "";
  const str = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "");

  switch (slot) {
    case "events":
      return ext || `${base}/events`;
    case "algo":
      return str("algoId") ? `${base}/algos/${str("algoId")}` : `${base}/algos`;
    case "wallet":
    case "user":
      return `${base}/admin/users`;
    case "tx": {
      const sub = str("subkind");
      if (sub === "algo_subscribe" && str("algoId")) return `${base}/algos/${str("algoId")}`;
      if (sub.startsWith("treasury_")) return `${base}/admin/revenue`;
      if (sub.startsWith("admin_wallet_")) return `${base}/admin/users`;
      if (sub === "order_paid" || sub === "withdrawal") return `${base}/admin`;
      return `${base}/admin`;
    }
  }
}

/** Batas konten Discord 2000 char — sisakan ruang utk URL. */
const CONTENT_LIMIT = 1900;

/** Sisipkan URL ke teks (opsi gabungan) tanpa memotong URL-nya. */
function withUrl(text: string, url: string): string {
  if (!url) return text;
  if (text.includes(url)) return text;
  const joined = text ? `${text} — ${url}` : url;
  if (joined.length <= CONTENT_LIMIT) return joined;
  const room = Math.max(0, CONTENT_LIMIT - url.length - 4);
  return `${text.slice(0, room).trimEnd()} … ${url}`;
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === "string" ? v : "";
}

function humanize(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/** Object/array/null dilewati — field embed hanya nilai primitif (maks 10). */
function fieldsFrom(data: Record<string, unknown>, skip: string[]): DiscordEmbedField[] {
  const out: DiscordEmbedField[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (skip.includes(key) || value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    const raw = String(value);
    if (!raw) continue;
    out.push({ name: humanize(key), value: raw.slice(0, 1024), inline: true });
    if (out.length >= 10) break;
  }
  return out;
}

function titleFor(slot: WebhookSlot, data: Record<string, unknown>): string {
  switch (slot) {
    case "events":
      return "New event posted";
    case "algo":
      return str(data, "name") ? `New algo: ${str(data, "name").slice(0, 200)}` : "New algo published";
    case "wallet":
      return `New ${str(data, "kind") || "mainnet"} wallet created`;
    case "user":
      return "New user registered";
    case "tx":
      return TX_LABEL[str(data, "subkind")] ?? "Transaction";
  }
}

/**
 * Bentuk body POST final. Urutan field disengaja agar receiver generik tetap
 * membaca `text`/`content` persis seperti versi lama (kini + URL di belakangnya).
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

  // Caption event penuh (tidak dipotong 140) utk deskripsi embed.
  const description =
    input.slot === "events" && str(data, "caption") ? str(data, "caption").slice(0, 4096) : text.slice(0, 4096);

  const fields = fieldsFrom(
    data,
    input.slot === "events" ? ["url", "caption"] : input.slot === "algo" ? ["name"] : [],
  );
  if (input.slot === "events" && str(data, "url")) {
    fields.unshift({ name: "Post", value: str(data, "url").slice(0, 1024), inline: false });
  }

  return {
    event: input.kind,
    slot: input.slot,
    text,
    content: text,
    url,
    ts: input.ts ?? new Date().toISOString(),
    data,
    username: style.username,
    avatar_url: `${siteBase()}/icon.png`,
    embeds: [
      {
        title: titleFor(input.slot, data).slice(0, 256),
        url,
        description,
        color: style.color,
        ...(fields.length ? { fields } : {}),
        footer: { text: `Artian Capital Group · ${style.label}` },
        timestamp: input.ts ?? new Date().toISOString(),
      },
    ],
  };
}
