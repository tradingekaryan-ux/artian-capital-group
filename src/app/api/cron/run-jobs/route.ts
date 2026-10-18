import { NextResponse } from "next/server";
import { SECRETS } from "@/lib/config";

/**
 * Endpoint job runner — dipanggil Cloudflare Cron Trigger `artian-cron`
 * tiap menit (fallback manual: GitHub Actions / curl) via `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!SECRETS.cronSecret || token !== SECRETS.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { runPendingJobs } = await import("@/lib/jobs/runner");
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? 10);
    const result = await runPendingJobs(Math.min(Math.max(limit, 1), 25));

    // Purge log harian: otomatis tiap 00:00 WITA (16:00 UTC, window5 menit),
    // atau paksa via ?purge=true (ujian E2E). Lihat src/lib/jobs/purge.ts.
    const now = new Date();
    const inWindow = now.getUTCHours() === 16 && now.getUTCMinutes() < 5;
    const force = url.searchParams.get("purge") === "true";
    let purge: unknown = null;
    if (force || inWindow) {
      try {
        const { purgeOldLogs } = await import("@/lib/jobs/purge");
        purge = await purgeOldLogs({ force });
      } catch (e) {
        console.error("[cron] purge failed:", e);
      }
    }

    return NextResponse.json({ ok: true, ...result, purge });
  } catch (e) {
    console.error("[cron] run-jobs failed:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
