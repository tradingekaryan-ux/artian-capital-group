/** Rate limit berbasis DB (tabel `rate_limit_events` + RPC `rate_limit_take`)
 * — atomik & shared lintas isolate Cloudflare Workers (menggantikan limiter
 * in-memory per-instance yang tidak efektif di multi-instance).
 *
 * @param failOpen  true  = izinkan request saat DB error (default; cocok untuk endpoint non-keuangan).
 *                  false = TOLAK request saat DB error (wajib untuk withdraw/swap/treasury).
 */

import { supabaseAdmin } from "@/lib/db/client";

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  { failOpen = true }: { failOpen?: boolean } = {},
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin().rpc("rate_limit_take", {
      p_key: key,
      p_window_ms: windowMs,
    });
    if (error) throw error;
    return (data as number) <= limit;
  } catch (e) {
    console.error(`[rateLimit] failed (fail-${failOpen ? "open" : "closed"}):`, e);
    // fail-closed = tolak untuk melindungi endpoint keuangan saat DB down.
    return failOpen;
  }
}

/**
 * IP klien dari header Cloudflare (CF-Connecting-IP), dengan fallback ke
 * X-Forwarded-For lalu "unknown". CF-Connecting-IP di-set Cloudflare dan
 * tidak bisa dimanipulasi klien biasa (tidak seperti X-Forwarded-For).
 */
export function clientIp(req: Request): string {
  // Cloudflare Workers: CF-Connecting-IP adalah IP asli yang terpercaya.
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  // Fallback untuk pengembangan lokal / proxy lain yang dipercaya.
  const xf = req.headers.get("x-forwarded-for");
  return xf?.split(",")[0]?.trim() ?? "unknown";
}
