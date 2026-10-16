import { NextResponse } from "next/server";
import { SECRETS } from "@/lib/config";

/**
 * Endpoint job runner untuk GitHub Actions cron / curl lokal.
 * Auth: `Authorization: Bearer $CRON_SECRET`
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!SECRETS.cronSecret || token !== SECRETS.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { runPendingJobs } = await import("@/lib/jobs/runner");
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 10);
    const result = await runPendingJobs(Math.min(Math.max(limit, 1), 25));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron] run-jobs gagal:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
