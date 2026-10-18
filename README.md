# Artian Capital Group

> **Status pembangunan (17 Okt 2026):** kode lengkap, `lint/typecheck/test (24 kasus)/build` hijau, **smoke test on-chain end-to-end LULUS di devnet**.
> Database Supabase **`vysgkjqbmgbbowsxafok`** sudah hidup: `apply_all.sql` (0001_init + 0002_storage + seed pricing) lewat MCP `apply_migration`; RLS advisors bersih; bucket `token-assets` aktif.
> Smoke test lulus: landing/explore/token detail/create/dashboard/admin (role guard + API 403), signup email (SMTP Supabase), auto-`profiles`+`wallets` ter-encrypt, seed 2 token live tampil & ter-sitemap.
> SEO: `robots.txt`, `sitemap.xml` (static + token live), JSON-LD `WebSite` + `WebPage`+harga.
> GitHub: repo **public** `tradingekaryan-ux/artian-capital-group` (public → lulus validasi faucet), CI hijau, 7 actions secrets terpasang, **Job Worker terverifikasi jalan end-to-end**.
> Adapter Cloudflare terpasang (`@opennextjs/cloudflare` + `wrangler.jsonc` + wrapper `scripts/cf-deploy.mjs` utk macOS < 13.5).
> **LIVE di produksi:** <https://artian-capital-group.trading-ekaryan.workers.dev> (secrets runtime terpasang; smoke login/dashboard/explore/token/admin lulus; sitemap/robots/JSON-LD memakai URL produksi).
> **Mode demo + multi-wallet (17 Okt):** tiap user punya banyak wallet mainnet + maks 1 wallet demo (devnet, deposit via faucet eksternal), create token/pool/LP di devnet dibayar USDC devnet; WD/swap dinonaktifkan di demo; registrasi diberi notifikasi batas SMTP Supabase ≈3 user/jam; **PostHog aktif**, `JUPITER_API_KEY` (Server key) terpasang sebagai Worker secret.
> **Arsip wallet + treasury admin (18 Okt):** user bisa arsipkan wallet non-aktif (soft-delete `archived_at`, aktif ditolak, terarsip tetap terlihat di admin dengan badge); admin panel tab Revenue punya kontrol **deposit/withdraw treasury USDC & SOL** (tujuan di-hardcode ke wallet aktif admin, pre-check saldo, cap 50k USDC/1k SOL, rate limit fail-closed); daftar wallet admin menampilkan entri virtual **Treasury wallet** (display-only, tanpa arsip); migrasi `0007_wallet_archive` terpasang di DB live.
> **On-chain devnet (via site live + worker lokal):** Helius key aktif, treasury 2.5 SOL (faucet.solana.com), wallet test 20 USDC (Circle) — order `create_token` (2 USDC → fee) → token **SMOKE** `7jjqC5F…` live (supply 1e9, mint+freeze revoked, muncul di explore) → order `create_pool` (10 USDC) → pool Raydium CPMM `Bb8qZniU…` aktif on-chain; order `confirmed` + `pools`/`tokens` tercatat.
> Bug yang diperbaiki saat smoke: env string-kosong tak fallback (`envOr`), race confirm Workers → tx finalized tapi dilempar expired (`recoverExpiredSignature` + order disimpan sebelum bayar), Metaplex authority/creators (`0xa`/`0x36`), Raydium feePayer asing → PrivilegeEscalation + `reject(undefined)` (gas-drop user, feePayer default owner).
> **Sisa:** ① rotate SEMUA kredensial yang pernah lewat chat (Supabase, PAT GitHub, Helius, token Cloudflare), ② spike/aturan fee-tier pool UI (F4), ③ lupa-password flow + QR deposit (lupa-password **dihapus** — tanpa Resend; OTP withdraw = devCode), ④ ~~`JUPITER_API_KEY`~~ sudah (Server key); `RESEND_API_KEY` sengaja dikosongkan.

Komunitas financial market + launcher token Solana dengan liquidity pool, on-ramp USDC (topup/withdraw dari wallet eksternal), swap in-app, burn token & Burn-Earn (reward point), pembayaran fee pakai USDC, serta **mode demo devnet + multi-wallet** untuk latihan sebelum pakai dana sungguhan — **tanpa biaya infrastruktur bulanan** (Supabase Free + Helius free + Cloudflare Workers + Cloudflare Cron Trigger).

Dokumen: [`docs/PRD.md`](docs/PRD.md) · [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)

## Stack

- **Next.js 16** (App Router, Turbopack, React 19, Tailwind v4, ESLint 9)
- **next-intl v4** — locale `/en` & `/id` (tanpa middleware, `createNextIntlPlugin`)
- **Supabase** (Postgres + Auth + Storage) — RLS penuh
- **Solana**: SPL Token + Metaplex umi (create token), **Raydium CPMM SDK v2** (pool & liquidity), **Jupiter** (swap), gas on-chain dibayar dari **saldo SOL milik user** (wallet user = fee-payer; platform tidak mendanai gas)
- **Worker**: `src/worker/run-jobs.ts` (queue job on-chain + refund), cron Cloudflare (`artian-cron`) tiap menit

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
| `npm run worker` | worker job on-chain (atau via cron Cloudflare / GitHub Actions manual) |
| `npm run deploy:cf` | build OpenNext + deploy ke Cloudflare Workers (butuh `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) |

## Environment

Lihat [`.env.example`](.env.example). Catatan:

- `NEXT_PUBLIC_SOLANA_CLUSTER=devnet|mainnet-beta` — USDC mint otomatis (`USDC_MINT` bisa dioverride). Saat ini **mainnet-beta** (wallet `kind=demo` tetap di devnet).
- `HELIUS_API_KEY` opsional (tanpa itu pakai RPC publik) — tanpa Helius, pemindaian balance TX paling akurat (getSignaturesForAddress) tidak tersedia dan terpaksa fallback.
- `RESEND_API_KEY` **sengaja kosong** (keputusan 17 Okt): tanpa reset password; kode OTP withdraw tampil langsung di UI (devCode, mode MVP).
- `JUPITER_API_KEY` sudah terisi (Server key dari developers.jup.ag) + terpasang sebagai Worker secret.
- Registrasi dibatasi ≈3 user/jam oleh SMTP Supabase — halaman register memberi tahu user bila batas tercapai.
- Inventaris secret lokal: `SECRETS.md` (gitignored, tidak ikut repo).

## CI/CD

- `.github/workflows/ci.yml` — lint + test + typecheck + build di tiap push/PR (Node 22).
- `.github/workflows/worker.yml` — cron `run-jobs` tiap menit (butuh secrets: `SUPABASE_*`, `CRON_SECRET`, `TREASURY_SECRET_KEY`, `WALLET_MASTER_KEY`, `SOLANA cluster`, dsb.).

## Biaya infrastruktur

**$0/bulan** — Supabase Free (2 proyek), Helius free tier, Jupiter/Raydium/DEXScreener API gratis, Cloudflare Cron Triggers, PostHog free tier (opsional). Gas on-chain **dibayar user dari saldo SOL miliknya** (user-paid gas) — biaya gas platform $0, operator tidak perlu mengisi treasury.
