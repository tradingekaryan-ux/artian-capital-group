/** Rate limit sederhana in-memory (per instance). Cukup untuk MVP; di produksi
 * multi-instance pertimbangkan Upstash/DB-backed limiter. */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let opsSinceSweep = 0;

/** Buang bucket kedaluwarsa — cegah pertumbuhan memori tanpa batas. */
function sweep(now: number): void {
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  // sweep ringan tiap ~1000 operasi
  if (++opsSinceSweep >= 1000) {
    opsSinceSweep = 0;
    sweep(now);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  return xf?.split(",")[0]?.trim() ?? "unknown";
}
