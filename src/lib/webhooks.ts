import { supabaseAdmin } from "@/lib/db/client";
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
