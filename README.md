# Artian Capital Group

> **Status pembangunan (16 Okt 2026):** kode lengkap, `lint/typecheck/test/build` hijau (38 halaman).
> Database Supabase **`vysgkjqbmgbbowsxafok`** sudah hidup: `apply_all.sql` (0001_init + 0002_storage + seed pricing) lewat MCP `apply_migration`; RLS advisors bersih; bucket `token-assets` aktif.
> Smoke test lulus: landing/explore/token detail/create/dashboard/admin (role guard + API 403), signup email (SMTP Supabase), auto-`profiles`+`wallets` ter-encrypt, seed 2 token live tampil & ter-sitemap.
> SEO: `robots.txt`, `sitemap.xml` (static + token live), JSON-LD `WebSite` + `WebPage`+harga.
> Langkah berikutnya: ① isi `HELIUS_API_KEY` (helius.com gratis) + airdrop devnet ke treasury `4XSuNGXFqH2sSMteAxHWjF1y3Pgf5aCdBT29Ve2MUWSg` (faucet publik sedang error) untuk smoke on-chain, ② commit + push ke GitHub → Cloudflare Pages + secrets GitHub Actions (`worker.yml`) — **menunggu persetujuan**, ③ restart `opencode` agar MCP github/cloudflare aktif.

Komunitas financial market + launcher token Solana dengan liquidity pool, on-ramp USDC (topup/withdraw dari wallet eksternal), swap in-app, dan pembayaran fee pakai USDC — **tanpa biaya infrastruktur bulanan** (Supabase Free + Helius free + Cloudflare Pages + GitHub Actions cron).

Dokumen: [`docs/PRD.md`](docs/PRD.md) · [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)

## Stack

- **Next.js 16** (App Router, Turbopack, React 19, Tailwind v4, ESLint 9)
- **next-intl v4** — locale `/en` & `/id` (tanpa middleware, `createNextIntlPlugin`)
- **Supabase** (Postgres + Auth + Storage) — RLS penuh
- **Solana**: SPL Token + Metaplex umi (create token), **Raydium CPMM SDK v2** (pool & liquidity), **Jupiter** (swap), treasury platform menanggung seluruh gas SOL
- **Worker**: `src/worker/run-jobs.ts` (queue job on-chain + refund), cron GitHub Actions tiap menit

## Setup lokal

```bash
npm install --legacy-peer-deps
cp .env.example .env
```

Isi minimal: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`TREASURY_SECRET_KEY` (base58 dari `solana-keygen new --no-bip39-passphrase`),
`WALLET_MASTER_KEY` (`openssl rand -base64 32`), `CRON_SECRET`.

Database — jalankan migrasi lewat Supabase CLI / SQL editor:

```
supabase/migrations/0001_init.sql   # skema inti + RLS
supabase/migrations/0002_storage.sql# bucket `token-assets` (public, 5MB)
```

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | dev server (http://localhost:3000) |
| `npm run lint` | ESLint |
| `npm test` | unit test (vitest: pricing + format) |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm run build` | production build |
| `npm run worker` | worker job on-chain (atau via GitHub Actions cron) |

## Environment

Lihat [`.env.example`](.env.example). Catatan:

- `NEXT_PUBLIC_SOLANA_CLUSTER=devnet|mainnet-beta` — USDC mint otomatis (`USDC_MINT` bisa dioverride).
- `HELIUS_API_KEY` opsional (tanpa itu pakai RPC publik) — tanpa Helius, pemindaian balance TX paling akurat (getSignaturesForAddress) tidak tersedia dan terpaksa fallback.
- `RESEND_API_KEY` opsional — tanpa ini kode OTP tampil di log dev saja.
- `JUPITER_API_KEY` opsional untuk rate limit tinggi.

## CI/CD

- `.github/workflows/ci.yml` — lint + test + typecheck + build di tiap push/PR (Node 22).
- `.github/workflows/worker.yml` — cron `run-jobs` tiap menit (butuh secrets: `SUPABASE_*`, `CRON_SECRET`, `TREASURY_SECRET_KEY`, `WALLET_MASTER_KEY`, `SOLANA cluster`, dsb.).

## Biaya infrastruktur

**$0/bulan** — Supabase Free (2 proyek), Helius free tier, Jupiter/Raydium/DEXScreener API gratis, GitHub Actions (60.000 menit/bulan), PostHog free tier (opsional). Gas on-chain seluruhnya ditanggung treasury platform.
