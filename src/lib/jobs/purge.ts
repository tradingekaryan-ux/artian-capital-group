import { supabaseAdmin } from "@/lib/db/client";

/**
 * Pembersihan log harian — dijadwalkan otomatis tiap 00:00 WITA
 * (16:00 UTC, window 5 menit) oleh /api/cron/run-jobs, atau dipaksa via
 * `?purge=true` (tetap butuh CRON_SECRET). Alasan: panel job berisi log
 * (price snapshot, index, forward, dll.) menumpuk tiap menit — DB cepat
 * penuh bila dibiarkan.
 *
 * - jobs        : hanya baris SELESAI (done/failed); pending/running
 *                 dibiarkan agar antrian tidak rusak.
 * - price_snapshots : retensi 30 hari (jendela chart tertua — fetchPriceHistory
 *                 "batas 30 hari"); baris lebih tua dibuang.
 * Pemicu berbasis marker `pricing_config.jobs_purged_at` (anti dobel
 * dalam window 5 menit / force beruntun).
 */
const PRICE_RETENTION_DAYS = 30;
const PURGE_MARKER_KEY = "jobs_purged_at";
const PURGE_MIN_GAP_MS = 45 * 60_000;

export interface PurgeResult {
  jobsDeleted: number;
  snapshotsDeleted: number;
}

export async function purgeOldLogs(opts: { force?: boolean } = {}): Promise<PurgeResult> {
  const db = supabaseAdmin();
  const now = Date.now();

  if (!opts.force) {
    const { data: marker } = await db
      .from("pricing_config")
      .select("value")
      .eq("key", PURGE_MARKER_KEY)
      .maybeSingle();
    const last = (marker?.value as { purged_at?: unknown } | null)?.purged_at;
    if (typeof last === "string" && now - Date.parse(last) < PURGE_MIN_GAP_MS) {
      return { jobsDeleted: 0, snapshotsDeleted: 0 };
    }
  }

  const { data: jobs, error: jErr } = await db
    .from("jobs")
    .delete()
    .in("status", ["done", "failed"])
    .select("id");
  if (jErr) throw new Error(jErr.message);

  const cutoff = new Date(now - PRICE_RETENTION_DAYS * 86_400_000).toISOString();
  const { data: snaps, error: sErr } = await db
    .from("price_snapshots")
    .delete()
    .lt("ts", cutoff)
    .select("ts");
  if (sErr) throw new Error(sErr.message);

  const { error: mErr } = await db
    .from("pricing_config")
    .upsert({ key: PURGE_MARKER_KEY, value: { purged_at: new Date(now).toISOString() } }, { onConflict: "key" });
  if (mErr) throw new Error(mErr.message);

  const result: PurgeResult = { jobsDeleted: jobs?.length ?? 0, snapshotsDeleted: snaps?.length ?? 0 };
  return result;
}
