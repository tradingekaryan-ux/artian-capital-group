#!/usr/bin/env node
/**
 * Deploy wrapper: menjalankan `wrangler deploy` langsung dengan OPEN_NEXT_DEPLOY=true,
 * melewati `getPlatformProxy` (miniflare/workerd) pada `opennextjs-cloudflare deploy`
 * yang crash di macOS < 13.5. populateCache (R2) & skew protection tidak dipakai —
 * aman dilewati karena tidak ada binding R2 / konfigurasi skew.
 *
 * Pakai: npm run deploy:cf  (otomatis re-exec lewat Node 22 bila perlu)
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 22) {
  const self = fileURLToPath(import.meta.url);
  const r = spawnSync("npx", ["-y", "node@22", self, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(r.status ?? 1);
}

const wranglerBin = path.join(
  process.cwd(),
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const r = spawnSync(process.execPath, [wranglerBin, "deploy", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, OPEN_NEXT_DEPLOY: "true" },
});
process.exit(r.status ?? 1);
