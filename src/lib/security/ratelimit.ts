/** Rate limit berbasis DB (tabel `rate_limit_events` + RPC `rate_limit_take`)
 * — atomik & shared lintas isolate Cloudflare Workers (menggantikan limiter
 * in-memory per-instance yang tidak efektif di multi-instance).
 * Fail-open: bila DB tidak terjangkau, request diizinkan (tersimpan di log). */

import { supabaseAdmin } from "@/lib/db/client";

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin().rpc("rate_limit_take", {
      p_key: key,
      p_window_ms: windowMs,
    });
    if (error) throw error;
    return (data as number) <= limit;
  } catch (e) {
    console.error("[rateLimit] failed (fail-open):", e);
    return true;
  }
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  return xf?.split(",")[0]?.trim() ?? "unknown";
}
