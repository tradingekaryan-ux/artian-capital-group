/**
 * Entry worker job-queue — dijalankan via GitHub Actions cron (1 menit)
 * atau lokal: `npm run worker`.
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
    const { done, failed } = await runPendingJobs(5);
    const ts = new Date().toISOString();
    console.log(`[worker ${ts}] done=${done} failed=${failed}`);
    if (done + failed === 0) {
      // tidak ada kerjaan — tetap jalankan job siklis bila belum ada
      await maybeScheduleCyclic();
    }
    if (loop) await new Promise((r) => setTimeout(r, 20_000));
  } while (loop);
}

/** Jadwalkan job berkala (idempoten: hanya bila tidak ada job serupa pending). */
async function maybeScheduleCyclic(): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/db/client");
  const { enqueue } = await import("@/lib/jobs/queue");
  const db = supabaseAdmin();
  for (const type of ["price_snapshot", "treasury_rebalance"] as const) {
    const { data } = await db
      .from("jobs")
      .select("id")
      .eq("type", type)
      .in("status", ["pending", "running"])
      .limit(1);
    if (!data?.length) await enqueue(type, {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
