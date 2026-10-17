/**
 * Cron trigger 1 menit → memicu job runner utama (artian-capital-group).
 * Menggantikan schedule GitHub Actions yang tidak andal.
 * Secret: CRON_SECRET (sama dengan worker utama).
 */
const cronWorker = {
  async scheduled(_event, env) {
    const res = await fetch(`${env.ARTIAN_ORIGIN}/api/cron/run-jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const body = await res.text();
    console.log(`run-jobs ${res.status} ${body}`);
    if (!res.ok) throw new Error(`run-jobs failed: ${res.status} ${body}`);
  },
};

export default cronWorker;
