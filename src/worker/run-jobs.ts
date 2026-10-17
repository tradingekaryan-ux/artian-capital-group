/**
 * Entry worker job-queue — dijalankan via GitHub Actions (manual fallback)
 * atau lokal: `npm run worker`.
 * Jadwal 1 menit di produksi: Cloudflare Cron Trigger `artian-cron` → /api/cron/run-jobs.
 *
 * Mendukung:
 *   npm run worker            → satu pass
 *   npm run worker -- --loop  → loop terus (interval 20 detik, untuk dev)
 */
import fs from "node:fs";
import path from "node:path";

/** Muat .env.local bila ada (worker di luar Next.js). */
function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key] === undefined) {
        process.env[key] = raw.replace(/^["']|["']$/g, "");
      }
    }
  }
}

async function main() {
  loadEnv();
  const { runPendingJobs } = await import("@/lib/jobs/runner");
  const loop = process.argv.includes("--loop");

  do {
    // runPendingJobs sudah menjamin penjadwalan ulang job siklis di akhir pass.
    const { done, failed } = await runPendingJobs(5);
    const ts = new Date().toISOString();
    console.log(`[worker ${ts}] done=${done} failed=${failed}`);
    if (loop) await new Promise((r) => setTimeout(r, 20_000));
  } while (loop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
