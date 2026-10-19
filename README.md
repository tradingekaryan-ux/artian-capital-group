# Artian Capital Group

> **Status pembangunan (18 Okt 2026):** kode lengkap, `lint/typecheck/test (46 kasus)/build` hijau, **smoke test on-chain end-to-end LULUS di devnet**.
> Database Supabase **`vysgkjqbmgbbowsxafok`** sudah hidup: migrasi **`0001_init` … `0010_webhooks`** (0008–0010 via SQL Editor manual) + seed pricing lewat MCP `apply_migration`; RLS advisors bersih; bucket `token-assets` aktif.
> Smoke test lulus: landing/explore/token detail/create/dashboard/admin (role guard + API 403), signup email (SMTP Supabase), auto-`profiles`+`wallets` ter-encrypt, seed 2 token live tampil & ter-sitemap.
> SEO: `robots.txt`, `sitemap.xml` (static + token live + `/faq`), JSON-LD `WebSite` + `WebPage`+harga; favicon ARTIAN (`src/app/icon.png` — PNG bulat transparan 512px, ganti favicon.ico default).
> GitHub: repo **public** `tradingekaryan-ux/artian-capital-group` (public → lulus validasi faucet), CI hijau, 7 actions secrets terpasang, **Job Worker terverifikasi jalan end-to-end**.
> Adapter Cloudflare terpasang (`@opennextjs/cloudflare` + `wrangler.jsonc` + wrapper `scripts/cf-deploy.mjs` utk macOS < 13.5).
> **LIVE di produksi:** <https://artian-capital-group.trading-ekaryan.workers.dev> (secrets runtime terpasang; smoke login/dashboard/explore/token/admin lulus; sitemap/robots/JSON-LD memakai URL produksi).
> **Mode demo + multi-wallet (17 Okt):** tiap user punya banyak wallet mainnet + maks 1 wallet demo (devnet, deposit via faucet eksternal), create token/pool/LP di devnet dibayar USDC devnet; WD/swap dinonaktifkan di demo; registrasi diberi notifikasi batas SMTP Supabase ≈3 user/jam; **PostHog aktif**, `JUPITER_API_KEY` (Server key) terpasang sebagai Worker secret.
> **Arsip wallet + treasury admin (18 Okt):** user bisa arsipkan wallet non-aktif (soft-delete `archived_at`, aktif ditolak, terarsip tetap terlihat di admin dengan badge); admin panel tab Revenue punya kontrol **deposit/withdraw treasury USDC & SOL** (tujuan di-hardcode ke wallet aktif admin, pre-check saldo, cap 50k USDC/1k SOL, rate limit fail-closed); daftar wallet admin menampilkan entri virtual **Treasury wallet** (display-only, tanpa arsip); migrasi `0007_wallet_archive` terpasang di DB live. **E2E terautentikasi (sesi admin via magiclink) live + lokal: 12/12 PASS** — termasuk guard "wallet aktif ditolak arsip" (bug guard-cookie ditemukan saat uji live & diperbaiki: resolusi aktif kini pakai `getActiveWallet()`, bukan cookie saja); micro-transfer treasury di-skip (saldo kedua sisi 0 — isi dulu bila ingin uji transfer nyata).
> **Operasi admin atas dompet user + purge log (18 Okt):** panel Users (detail user) kini punya **form topup/withdraw dompet user** (USDC/SOL, mitra = wallet aktif admin, gas dibayar admin, cap 50k/1k + rate limit fail-closed + audit), **tombol hapus dompet permanen** (guard: saldo on-chain hampir nol — USDC=0 & SOL<0.001, kalau belum kosong disuruh withdraw dulu), dan daftar **algo milik user + hapus permanen** (`DELETE /api/algos/[id]`, admin-only, cascade); **purge log harian00:00 WITA** di `POST /api/cron/run-jobs` (window 16:00–16:04 UTC + marker anti-dobel; hapus `jobs` done/failed & `price_snapshots` >30 hari agar DB tidak cepat penuh; `?purge=true` untuk paksa/uji). E2E admin kini **26 cek**.
> **Webhook alert6 slot (18 Okt — format teks, TANPA embed):** admin set **URL terpisah per slot** di kartu **Webhook alerts** (halaman Admin): `Event Tracker`, `Transactions`, `New wallet`, `New algo`, `New user` (deteksi otomatis tiap menit via job siklis `user_alert_scan`), **`New token`** (baru — token selesai dibuat on-chain, dibidik dari job `create_token`). Kirim lewat job queue (retry3× backoff30s, timeout8s; envelope JSON `{event, slot, text, content, url, ts, data, username, avatar_url, embeds}`). **Tampilan Discord = pesan teks biasa** (`embeds` selalu `[]`) — **URL ditulis polos di dalam teks** (bukan `[label](url)`/`<url>`) sehingga **Discord mendeteksi link sendiri dan membuat website card** (preview otomatis dari og-meta halaman tujuan):
> - **`events`** → `New event posted` + caption (potong 280) + URL post — tidak ada lain-lain
> - **`wallet`** → `New wallet — mainnet/devnet` + alamat lengkap · **`user`** → `New user — @username`
> - **`algo`** → `New algo — <nama>` + URL `/algos/[id]` · **`token`** → `New token — <nama> (SIMBOL) · mainnet/devnet` + URL halaman token + **URL mint di Solana Explorer** (dua kartu)
> - **`tx`** → `New Transaction — <jenis transaksi>` + `tx <signature>` + **URL cek ke jaringan Solana** (`explorer.solana.com/tx/…?cluster=…`; dompet demo otomatis `cluster=devnet`)
>
> **og-meta** ditambahkan agar kartu tampil jelas: root layout (siteName/deskripsi/gambar), `/algos/[id]` (`generateMetadata` baru), `/token/[mint]` (memakai **logo token** sebagai gambar). `username`/`avatar_url` (`/icon.png`) tetap dipakai sbg nama pengirim; **receiver generik (postman/n8n) tetap membaca `text` (identik `content`) & `url` top-level**. URL kosong = nonaktif; validasi anti-SSRF saat disimpan; `GET/PATCH /api/admin/webhooks`; migrasi **0010_webhooks** (slot `token` **tanpa migrasi baru** — key `webhook_token` dibuat otomatis oleh PATCH admin saat URL pertama diset). E2E admin **46 cek** (cek slot kini 6). Format teks ini menggantikan versi embed (yang justru menghalangi Discord membuat kartu); riwayat perbaikan 18 Okt: mapping nominal `tx` salah & alert `user` dobel (marker scan kini disimpan + diverifikasi sebelum mengumumkan).
> **Tombol Discord (18 Okt):** tombol popup blurple di kanan-bawah semua halaman → kartu "Join our Discord" + tombol join (tab baru); URL invite di-set admin lewat kartu **Webhook alerts** (baris **Discord invite**), dibaca client dari `GET /api/discord`; kosong → tombol disembunyikan.
> **FAQ (18 Okt):** halaman `/faq` — **7 seksi, 27 Q&A accordion** (Getting started · Token launcher & markets · Wallets & transactions · How fees work · Algo marketplace (signals) · Event Tracker & community · Troubleshooting) dengan metadata SEO sendiri; tautan di **nav & footer**, masuk `sitemap.xml`, redirect `/faq` → `/en/faq` (URL tanpa prefix) di `next.config.ts`; file `src/app/[locale]/faq/page.tsx`.
> **Fix DELETE idempoten (18 Okt):** respons **404 JSON** dari endpoint `DELETE` kini dianggap **sukses** di **9 aksi hapus UI** (6 komponen: feed sinyal algo, hook, slot, komentar, event, wallet, algo) — sebelumnya muncul error 404 palsu ketika data sudah terhapus lebih dulu.
> **Hardening keamanan (17–18 Okt):** rate limit berbasis **DB** (`rate_limit_events` + RPC `rate_limit_take` — atomic & lintas isolate, gagal → fail-closed), **security headers + CSP** di `next.config.ts` (X-Frame-Options DENY, X-Content-Type-Options, HSTS 2 tahun, Referrer-Policy, Permissions-Policy, CSP hanya izinkan Supabase/PostHog/Helius/RPC Solana), plus perbaikan **13 temuan audit** (C1–C4, H1–H6, M2, M4, M5, M7, L5) dan **19 temuan audit** (idempotensi, fee withdraw, presisi, FK, loop).
> **On-chain devnet (via site live + worker lokal):** Helius key aktif, treasury 2.5 SOL (faucet.solana.com), wallet test 20 USDC (Circle) — order `create_token` (2 USDC → fee) → token **SMOKE** `7jjqC5F…` live (supply 1e9, mint+freeze revoked, muncul di explore) → order `create_pool` (10 USDC) → pool Raydium CPMM `Bb8qZniU…` aktif on-chain; order `confirmed` + `pools`/`tokens` tercatat.
> Bug yang diperbaiki saat smoke: env string-kosong tak fallback (`envOr`), race confirm Workers → tx finalized tapi dilempar expired (`recoverExpiredSignature` + order disimpan sebelum bayar), Metaplex authority/creators (`0xa`/`0x36`), Raydium feePayer asing → PrivilegeEscalation + `reject(undefined)` (gas-drop user, feePayer default owner).
> **Sisa:** ① rotate SEMUA kredensial yang pernah lewat chat (Supabase, PAT GitHub, Helius, token Cloudflare), ② spike/aturan fee-tier pool UI (F4), ③ lupa-password flow + QR deposit (lupa-password **dihapus** — tanpa Resend; OTP withdraw = devCode), ④ ~~`JUPITER_API_KEY`~~ sudah (Server key); `RESEND_API_KEY` sengaja dikosongkan.

Komunitas financial market + launcher token Solana dengan liquidity pool, on-ramp USDC (topup/withdraw dari wallet eksternal), swap in-app, burn token & Burn-Earn (reward point), **algo marketplace** (creator terbitkan sinyal via webhook — gratis/berbayar USDC; feed publik; subscriber pasang slot forward ke Discord dll; komisi flat admin), **event tracker** (admin posting link X/URL apa pun + caption, tampil sebagai kartu preview), **halaman FAQ** (`/faq` — 7 seksi cara kerja fitur, ekosistem & transaksi), pembayaran fee pakai USDC, serta **mode demo devnet + multi-wallet** untuk latihan sebelum pakai dana sungguhan — **tanpa biaya infrastruktur bulanan** (Supabase Free + Helius free + Cloudflare Workers + Cloudflare Cron Trigger).

Dokumen: [`docs/PRD.md`](docs/PRD.md) · [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)

## Stack

- **Next.js 16** (App Router, Turbopack, React 19, Tailwind v4, ESLint 9)
- **next-intl v4** — **English saja, URL tanpa prefix** (`/en/*` & `/id/*` di-redirect ke versi tanpa prefix, segment `[locale]` internal; `messages/` hanya `en.json`; tanpa middleware, `createNextIntlPlugin`)
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

Database — jalankan migrasi lewat Supabase CLI / SQL editor (daftar lengkap `supabase/migrations/`):

```
supabase/migrations/0001_init.sql          # skema inti + RLS
supabase/migrations/0002_storage.sql       # bucket `token-assets` (public, 5MB)
supabase/migrations/0003–0010              # multi-wallet, audit fixes, rate limit, burn,
                                           # wallet archive, algo, events, webhooks
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
- **URL webhook alert (5 slot) + URL invite Discord** bukan file secret — disimpan di **DB** (`pricing_config`, di-set admin via kartu *Webhook alerts*); nilai terakhir saat ini tidak dicatat di file mana pun (lihat `SECRETS.md` §6).
- Registrasi dibatasi ≈3 user/jam oleh SMTP Supabase — halaman register memberi tahu user bila batas tercapai.
- Inventaris secret lokal: `SECRETS.md` (gitignored, tidak ikut repo).

## CI/CD

- `.github/workflows/ci.yml` — lint + test + typecheck + build di tiap push/PR (Node 22).
- `.github/workflows/worker.yml` — cron `run-jobs` tiap menit (butuh secrets: `SUPABASE_*`, `CRON_SECRET`, `TREASURY_SECRET_KEY`, `WALLET_MASTER_KEY`, `SOLANA cluster`, dsb.).

## Biaya infrastruktur

**$0/bulan** — Supabase Free (2 proyek), Helius free tier, Jupiter/Raydium/DEXScreener API gratis, Cloudflare Cron Triggers, PostHog free tier (opsional). Gas on-chain **dibayar user dari saldo SOL miliknya** (user-paid gas) — biaya gas platform $0, operator tidak perlu mengisi treasury.
