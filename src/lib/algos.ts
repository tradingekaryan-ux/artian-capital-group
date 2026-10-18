import { supabaseAdmin } from "@/lib/db/client";
import { getPricing, usdcToRaw } from "@/lib/payment/pricing";

export const ALGO_MAX_HOOKS = 5;
export const ALGO_MAX_SLOTS = 3;
export const ALGO_FEED_PAGE = 50;
export const ALGO_MSG_MAX_BYTES = 32_768;
export const ALGO_FORWARD_TIMEOUT_MS = 8_000;
export const ALGO_SUBSCRIBE_SOL_BUFFER = 0.01; // gas buffer preflight (SOL)
export const DEFAULT_COMMISSION_USDC = 1; // fallback bila pricing_config kosong

export interface AlgoRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  price_usdc: string; // numeric → string via PostgREST
  billing: "lifetime" | "monthly";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlgoSubRow {
  id: string;
  algo_id: string;
  user_id: string;
  status: "active" | "expired" | "canceled";
  billing: "lifetime" | "monthly";
  price_raw: string;
  commission_raw: string;
  tx_signature: string | null;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
}

export interface AlgoSlotRow {
  id: string;
  algo_id: string;
  user_id: string;
  dest_url: string;
  active: boolean;
  last_status: string | null;
  last_delivered_at: string | null;
  created_at: string;
}

/** Komisi platform TETAP (USDC) per pembayaran langganan — dari pricing_config. */
export async function getAlgoCommissionRaw(): Promise<bigint> {
  const all = await getPricing();
  const v = all["algo_commission"]?.amount_usdc;
  const ok = typeof v === "number" && Number.isFinite(v) && v >= 0;
  return usdcToRaw(ok ? (v as number) : DEFAULT_COMMISSION_USDC);
}

/** Ringkas payload JSON apa pun jadi satu baris teks untuk list feed. */
export function extractText(payload: unknown): string {
  const src = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" || typeof v === "boolean") return String(v);
    }
    return "";
  };
  const parts = [
    pick("title", "headline", "name"),
    pick("message", "msg", "text", "body", "reason", "description"),
    pick("symbol", "pair", "ticker"),
    pick("side", "action", "direction"),
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ").slice(0, 500);
  try {
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return String(payload).slice(0, 500);
  }
}

/** Langganan valid = status active + (lifetime | belum expired). */
export function isSubActive(sub: Pick<AlgoSubRow, "status" | "expires_at"> | null | undefined): boolean {
  if (!sub || sub.status !== "active") return false;
  if (!sub.expires_at) return true;
  return new Date(sub.expires_at).getTime() > Date.now();
}

/** Row langganan TERBARU per (algo,user) — dasar validitas slot. */
export async function getLatestSub(algoId: string, userId: string): Promise<AlgoSubRow | null> {
  const { data } = await supabaseAdmin()
    .from("algo_subscriptions")
    .select("*")
    .eq("algo_id", algoId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AlgoSubRow | null) ?? null;
}

/**
 * Guard SSRF untuk URL tujuan slot (best-effort):
 * hanya http(s), tolak localhost / domain internal / IP privat / IPv6 literal.
 */
export function assertSafeDestUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL tidak valid");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("URL harus http atau https");
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    throw new Error("URL tujuan tidak diizinkan");
  }
  if (host.startsWith("[") || host.includes(":")) {
    throw new Error("URL tujuan tidak diizinkan"); // IPv6 literal
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const priv =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
    if (priv) throw new Error("URL tujuan tidak diizinkan");
  }
  return u.toString();
}

/**
 * Slot aktif milik subscriber dengan langganan VALID untuk algo ini
 * (langganan expired → slot otomatis pause).
 */
export async function activeSlotsForAlgo(algoId: string): Promise<{ id: string; dest_url: string; user_id: string }[]> {
  const db = supabaseAdmin();
  const { data: slots } = await db
    .from("algo_slots")
    .select("id, user_id, dest_url")
    .eq("algo_id", algoId)
    .eq("active", true);
  if (!slots?.length) return [];
  const userIds = [...new Set(slots.map((s) => s.user_id as string))];
  const { data: subs } = await db
    .from("algo_subscriptions")
    .select("user_id, status, expires_at, created_at")
    .eq("algo_id", algoId)
    .in("user_id", userIds)
    .order("created_at", { ascending: false });
  const latest = new Map<string, { status: string; expires_at: string | null }>();
  for (const s of subs ?? []) {
    if (!latest.has(s.user_id)) latest.set(s.user_id, { status: s.status, expires_at: s.expires_at });
  }
  return slots.filter((s) => isSubActive(latest.get(s.user_id) as AlgoSubRow | undefined));
}

function forwardBody(algo: { id: string; name: string }, messageId: number, text: string, payload: unknown) {
  return JSON.stringify({ algoId: algo.id, algoName: algo.name, messageId, text, payload });
}

/**
 * Kirim satu message ke semua slot valid (inline). Return daftar slot id
 * yang GAGAL (untuk di-retry via job `algo_forward`).
 */
export async function deliverToSlots(
  algo: { id: string; name: string },
  messageId: number,
  text: string,
  payload: unknown,
  onlySlotIds?: string[],
): Promise<{ sent: number; failed: string[] }> {
  const db = supabaseAdmin();
  let slots = await activeSlotsForAlgo(algo.id);
  if (onlySlotIds) {
    const want = new Set(onlySlotIds);
    slots = slots.filter((s) => want.has(s.id));
  }
  if (slots.length === 0) return { sent: 0, failed: [] };

  const body = forwardBody(algo, messageId, text, payload);
  const failed: string[] = [];
  let sent = 0;

  await Promise.all(
    slots.map(async (slot) => {
      let status: string;
      let ok = false;
      try {
        const res = await fetch(slot.dest_url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(ALGO_FORWARD_TIMEOUT_MS),
        });
        ok = res.ok;
        status = ok ? "ok" : `http ${res.status}`.slice(0, 120);
      } catch (e) {
        status = (e instanceof Error ? e.message : String(e)).slice(0, 120);
      }
      if (ok) sent += 1;
      else failed.push(slot.id);
      await db
        .from("algo_slots")
        .update({
          last_status: status,
          ...(ok ? { last_delivered_at: new Date().toISOString() } : {}),
        })
        .eq("id", slot.id);
    }),
  );
  return { sent, failed };
}

/** Ambil algo by id (null bila tidak ada). */
export async function getAlgo(algoId: string): Promise<AlgoRow | null> {
  const { data } = await supabaseAdmin().from("algos").select("*").eq("id", algoId).maybeSingle();
  return (data as AlgoRow | null) ?? null;
}
