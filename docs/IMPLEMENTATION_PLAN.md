# Implementation Plan — Artian Capital Group

| | |
|---|---|
| **Versi** | 1.3 |
| **Tanggal** | 18 Oktober 2026 |
| **Status** | **LIVE** di Cloudflare Workers (`npm run deploy:cf`); kode F0–F6 + F-J…F-P (burn, algo, events, admin ops, webhook, FAQ) selesai; migrasi 0001–0010; CI hijau; smoke devnet lulus; E2E live admin 46/46 · algo 50/50 · events 19/19 |
| **Dokumen saudara** | `docs/PRD.md` (lihat §13 status & deviasi) · `README.md` · `SECRETS.md` (gitignored) |
| **Estimasi total** | 8–10 minggu (1 developer full-time) |
| **Biaya infrastruktur** | $0/bulan |

---

## 1. Tech Stack & Alasan

| Layer | Pilihan | Alasan | Alternatif yang ditolak |
|---|---|---|---|
| Framework | **Next.js 16.4 (App Router, Turbopack, React 19) + TypeScript** | SSR untuk SEO halaman token, API route terintegrasi; typecheck = `next typegen && tsc` (tipe route global `PageProps`/`RouteContext` butuh typegen) | Vite+Express (SEO susah), SvelteKit (ekosistem Solana lebih tipis); Next 15 (ketinggalan, konvensi berubah) |
| UI | **Tailwind CSS v4** (CSS-first via `@tailwindcss/turbopack`, tanpa `tailwind.config.ts`) + komponen sendiri | Cepat, tanpa runtime berat, konsisten | MUI (bundle besar) |
| i18n | **next-intl** | Rute ber-prefix `/id`, server-first, ringan | react-i18next (client-heavy) |
| Hosting | **Cloudflare Workers (via `@opennextjs/cloudflare`)** | Tier gratis, **boleh dipakai komersial**, CDN global, WebSocket/polling cukup | **Vercel Hobby — ditolak: ToS melarang pemakaian komersial**; Netlify (boleh, tapi Cloudflare lebih murah di egress) |
| Database + Auth + Storage | **Supabase Free** (Postgres, Auth, Storage, RLS) | Semua kebutuhan inti dalam 1 layanan gratis: 500MB DB, 50k MAU, 1GB storage, 500k edge fn | Neon+Clerk (dua vendor), Firebase (vendor lock-in kuat) |
| RPC Solana | **Helius Free** (10 RPS, 1M credit/bln) + fallback `api.mainnet-beta.solana.com` | DAS API & priority fee tersedia gratis | RPC publik saja (gampang kena 429) |
| Token creation | **Metaplex umi** (`umi-bundle-defaults` + `mpl-token-metadata`) di atas `@solana/web3.js` + `@solana/spl-token` | Satu alur `createV1` (mint+metadata) + instruksi SPL; **payer & authority = wallet user** (gas dari saldo SOL user) | Instruksi legacy manual (kode lebih panjang, rawan salah urutan); Token-2022 metadata extension (kompatibilitas wallet/DEX lebih berisiko) |
| Liquidity pool | **Raydium SDK v2 (CPMM)** | Dokumentasi lengkap, permissionless, dukungan Token-2022, biaya pembuatan pool ~0.2 SOL | AMM v4 (butuh OpenBook market, lebih mahal); **spike F4** membandingkan Meteora DAMM v2 & Orca untuk biaya termurah |
| Swap | **Jupiter Aggregator API** (free key) | Rute terbaik, endpoint `/swap` siap pakai, gratis | Orca/Raydium swap langsung (rute terbatas) |
| Market data | **DexScreener API + Jupiter Price API** + snapshot internal | Gratis, tanpa kartu kredit | Birdeye (butuh API key berbayar untuk kuota besar) |
| Job queue & cron | **GitHub Actions** (`worker.yml` cron per menit → `npx tsx src/worker/run-jobs.ts`) + tabel `jobs` + trigger cadangan `POST /api/cron/run-jobs` | 100% gratis, tahan lama untuk tx on-chain, tidak terikat durasi serverless; cron per menit juga jadi heartbeat DB | Vercel Cron (Hobby maks 1×/hari), BullMQ (butuh Redis berbayar), Cloudflare Cron (kuota lebih kecil) |
| Metadata & logo | **Supabase Storage** | Gratis & tanpa kartu | Arweave (berbayar ~$0.01–0.10/file) → opsi upgrade F7 |
| Secrets | Environment Cloudflare Workers / Supabase Edge secrets | Tidak pernah di repo | .env di server (di hosting serverless tidak ada) |

### 1.1 Aturan tier gratis (dipatuhi agar $0/bulan)
1. Cloudflare (boleh komersial) sebagai hosting — **bukan** Vercel Hobby.
2. Supabase Free tetap hangat via **cron heartbeat ≥ 1×/jam** (hindari pause 7 hari).
3. Trigger upgrade (dari revenue, bukan modal): Supabase Pro $25/bln saat > 1.000 user aktif/bulan atau > 400MB DB; Helius Developer $49/bln saat RPC error > 2% harian.

---

## 2. Arsitektur Sistem

```
                         ┌──────────────────────────────────────────┐
  Browser (EN/ID)  ───▶  │  Next.js on Cloudflare Workers            │
                         │  - SSR/ISR pages  - Route handlers (API) │
                         └───────┬──────────────────────┬───────────┘
                                 │                      │
                    ┌────────────▼─────────┐   ┌────────▼────────────┐
                    │ Supabase Postgres    │   │ Solana RPC (Helius) │
                    │ + Auth + Storage     │   │ + fallback publik   │
                    │ RLS per user         │   └────────┬────────────┘
                    └────────────▲─────────┘            │
                                 │            ┌──────────▼───────────┐
                    ┌────────────┴─────────┐  │ Treasury hot wallet  │
                    │ GitHub Actions Worker│─▶│ (penerima fee USDC + │
                    │ - job queue runner   │  │  sumber refund)      │
                    │ - price snapshot     │  │ gas = saldo SOL user │
                    │ - indexer heartbeat  │  └──────────────────────┘
                    └──────────────────────┘  │ Jupiter / Raydium /  │
                                              │ DexScreener API      │
                                              └──────────────────────┘
```

**Prinsip eksekusi:** request user **tidak pernah menunggu on-chain**. Request hanya menulis baris `jobs` → worker GitHub Actions mengambil job, membangun & mengirim transaksi, memperbarui status → UI membaca status via polling ringan (maks 5 detik).

### 2.1 Alur penting
1. **Registrasi** → Supabase Auth (OTP email) → saat first-login, `ensureProfile`/`ensureWallet` (`src/lib/profiles.ts`) membuat `profiles` + `wallets` (keypair baru, dienkripsi) dari aplikasi — sengaja **tanpa trigger DB** `handle_new_user` agar seluruh bootstrap bisa diuji/di-debug di satu lapisan code.
2. **Topup** → user kirim **USDC** (fee layanan) & **SOL** (gas) ke alamat miliknya → indexer menangkap mutasi → `wallet_events` + `balances_cache`.
3. **Order create token** → API cek saldo **USDC + preflight SOL** (`requiredSolFor`) → transfer USDC user→treasury (tx #1, `awaiting_payment→paid`; fee-payer = user) → job `create_token` → worker: upload metadata → bangun tx (mint+metadata+ATA+supply, **payer & authority = wallet user**) → kirim → `confirmed` → row `tokens` + halaman `/token/{mint}`.
4. **LP** → order `create_pool` (tx bayar fee) → job → worker Raydium `cpmm.createPool` (gas dari saldo SOL user; tanpa gas-drop) → LP token ke wallet user → row `pools`.
5. **Withdrawal** → OTP → job → tx transfer USDC dari wallet user ke tujuan (**fee payer = wallet user**) → `confirmed`.
6. **Mode demo (devnet)** → user buat/aktifkan wallet demo (maks 1) → faucet manual SOL+USDC devnet (user tempel alamatnya di faucet.solana.com / faucet.circle.com) → order `create_token`/`create_pool`/`add_liquidity` dibayar **USDC devnet** dari wallet demo ke treasury devnet → job memakai RPC/program devnet (`networkFor("demo")`) → row `tokens`/`pools` bertanda `kind='demo'` (tersembunyi dari explore). Tanpa withdraw/swap di mode demo.

### 2.2 Keamanan signing service
- Master key enkripsi (`WALLET_MASTER_KEY`, 32 byte base64) hanya di secrets runtime.
- Dekripsi dilakukan **sesingkat mungkin** di memori (decode → tanda tangan → buang), tidak pernah di-log/di-cache.
- Treasury key (`TREASURY_SECRET_KEY`) terpisah dari key user; disimpan terenkripsi dengan master key yang sama, diarahkan lewat env. Treasury hanya menandatangani transaksi penerimaan fee & refund — **bukan** fee-payer transaksi user (gas = saldo SOL user).
- Setiap pemakaian dicatat `audit_logs` (aksi, target, tx signature, IP).

---

## 3. Struktur Repository

```
artian-capital/
├── docs/                        # PRD.md, IMPLEMENTATION_PLAN.md
├── .github/workflows/
│   ├── ci.yml                   # lint + test + typecheck + build (Node 22)
│   └── worker.yml               # cron 1 menit: run-jobs (job on-chain + job siklis)
├── supabase/
│   ├── migrations/              # 0001_init … 0010_webhooks (0005 rate_limit, 0006 burn, 0007 wallet_archive,
│   │                            # 0008 algo, 0009 events, 0010 webhooks) + apply_all.sql
│   └── seed.sql
├── scripts/
│   └── cf-deploy.mjs            # wrapper deploy CF (re-exec Node 22 utk macOS < 13.5)
├── src/
│   ├── app/
│   │   ├── page.tsx             # redirect → /en
│   │   ├── icon.png             # favicon ARTIAN (PNG bulat transparan 512px)
│   │   ├── [locale]/            # en = satu-satunya bahasa (URL tanpa prefix; /en & /id di-redirect)
│   │   │   ├── page.tsx         # landing (statistik DB)
│   │   │   ├── explore/  create/  token/[mint]/  algos/  algos/[id]/  events/  faq/
│   │   │   ├── login/  register/  verify/
│   │   │   ├── dashboard/       # overview, wallet, orders, tokens, algos (layout: ensureProfile+ensureWallet)
│   │   │   └── admin/           # overview, pricing, webhooks+discord, users (topup/withdraw/hapus), orders, jobs
│   │   └── api/
│   │       ├── orders/          # POST buat order, GET [id] (polling)
│   │       ├── wallet/          # balance, swap, withdraw, withdraw/verify, active, [id] (arsip)
│   │       ├── community/       # comments, watchlist
│   │       ├── algos/  events/  discord
│   │       ├── admin/           # overview, pricing, webhooks, treasury, users/[id]/wallet, jobs
│   │       └── cron/run-jobs    # trigger manual (Bearer CRON_SECRET) + purge log 00:00 WITA
│   ├── components/              # nav, footer, auth-form, verify-form, create/wizard,
│   │                            # market/ (chart, watchlist-button), pools/pool-panel,
│   │                            # wallet/ (withdraw-card, swap-card), community/, admin/panel,
│   │                            # algos/ (algo-manager, algo-view), events/, DiscordButton
│   ├── i18n/                    # routing, request, navigation (next-intl v4)
│   ├── lib/
│   │   ├── chain/               # token-create (umi), pool (Raydium CPMM), swap (Jupiter), usdc, assets
│   │   ├── payment/             # pricing, orders (state machine + idempotency + pay/refund)
│   │   ├── jobs/                # queue (claim, retry 3× backoff 30s), runner (handler on-chain)
│   │   ├── solana/  db/  security/  market/
│   │   ├── profiles.ts  admin.ts  analytics.ts  format.ts  config.ts
│   ├── worker/run-jobs.ts       # entry GitHub Actions: claim job + enqueue job siklis
├── messages/en.json            # English-only (messages/id.json dihapus 17 Okt)
├── next.config.ts               # plugin next-intl + Tailwind v4 + security headers/CSP + redirect/rewrite URL tanpa prefix
├── README.md  .env.example
└── package.json                 # lint / test / typecheck / build / worker
```

---

## 4. Skema Database (ringkas)

```sql
-- inti akun & wallet (bootstrap via ensureProfile/ensureWallet, tanpa trigger DB)
profiles(user_id uuid pk→auth.users, username unique, display_name, bio, role text default 'user',
         is_suspended bool default false, created_at)
-- multi-wallet: banyak mainnet per user (label), maks 1 demo per user (partial unique index)
-- 0007: archived_at (soft-delete) — indeks unik demo hanya hitung non-arsip
wallets(id uuid pk, user_id→profiles, kind text check in (mainnet,demo) default 'mainnet',
        label text, public_key text unique, enc_secret_key text, iv text, auth_tag text, created_at,
        archived_at timestamptz null,
        unique index (user_id) where kind='demo' and archived_at is null)
wallet_events(id bigserial, user_id, wallet_id, kind text default 'mainnet',
              type text check in (deposit,payment,withdrawal,swap,refund,lp),
              mint text, amount_raw numeric, signature text, meta jsonb, confirmed_at timestamptz,
              unique(user_id, signature, type, mint))
balances_cache(wallet_id pk→wallets, user_id, usdc_raw numeric, sol_lamports bigint, refreshed_at)

-- order & layanan (kind: mainnet = cluster utama mengikuti env; demo = selalu devnet)
orders(id uuid pk, user_id, wallet_id, kind text default 'mainnet' check in (mainnet,demo),
       service text check in (create_token,create_pool,add_liquidity,
       remove_liquidity,withdraw,swap), amount_raw bigint, status text check in (awaiting_payment,paid,
       processing,confirmed,failed,refunded,cancelled), pricing jsonb, config jsonb,
       payment_signature text unique, idempotency_key text unique, tx_signature text,
       error text, created_at, updated_at)
tokens(id uuid pk, user_id, wallet_id, kind text default 'mainnet', mint unique, order_id→orders,
       name, symbol, decimals int, supply numeric, logo_uri, metadata_uri, description, socials jsonb,
       revoke_mint bool, revoke_freeze bool, immutable bool,
       status text check in (pending,live,failed), created_tx text, created_at)
pools(id uuid pk, user_id, wallet_id, kind text default 'mainnet', token_id→tokens,
      dex default 'raydium_cpmm', pool_id unique, quote_mint,
      fee_tier numeric default 0.25, initial_price numeric, lp_percentage numeric, lp_raw numeric,
      token_amount numeric, quote_amount numeric, status check in (pending,active,failed), created_tx, created_at)
pool_positions(id, user_id, pool_id, lp_raw, deposited_token, deposited_quote, updated_at,
               unique(user_id, pool_id))

-- pasar & komunitas
price_snapshots(mint, ts, price_usd, liquidity_usd, volume_24h_usd, fdv_usd, pk(mint,ts))
watchlists(user_id, mint, pk(user_id,mint))
comments(id, user_id, mint, body, status(active|hidden), created_at)
withdrawals(id uuid, user_id, amount_raw, destination, status(pending|processing|confirmed|failed),
            otp_hash, otp_expires_at, tx_signature, error, created_at)
audit_logs(id, actor, action, target, payload jsonb, ip, created_at)
pricing_config(key pk, value jsonb, updated_by, updated_at)
jobs(id bigserial, type, payload jsonb, status, attempts int default 0, run_at, last_error, created_at)

-- 0008: algo marketplace (feed sinyal berlangganan; service-role only, RLS tanpa policy)
algos(id uuid pk, user_id→profiles, name, description, price_usdc numeric default 0,
      billing check in (lifetime,monthly) default 'lifetime', is_active bool default true,
      created_at, updated_at)
algo_hooks(id uuid pk, algo_id→algos, token text unique, label, active bool, last_used_at, created_at)
algo_messages(id bigserial pk, algo_id→algos, hook_id→algo_hooks null, payload jsonb, text, created_at)
algo_subscriptions(id uuid pk, algo_id, user_id→profiles, status check in (active,expired,canceled),
      billing check in (lifetime,monthly), price_raw text, commission_raw text, tx_signature,
      starts_at, expires_at null=lifetime, created_at)
algo_slots(id uuid pk, algo_id, user_id, dest_url, active bool, last_status, last_delivered_at, created_at)
-- jobs.type ditambah 'algo_forward' (retry forward feed→slot; constraint di-drop/re-add)

-- 0009: event tracker (admin posting URL + caption; meta = preview kartu)
events(id uuid pk, url text, caption text, meta jsonb default '{}',
       created_by uuid→profiles, created_at, index (created_at desc))
```

**RLS wajib:** semua tabel user-scoped memakai policy `auth.uid() = user_id`; tabel publik (`tokens`, `price_snapshots`, `comments`) dibaca publik, tulis hanya lewat service role (server) — bukan anon key.

---

## 5. Permukaan API (Route Handlers — aktual)

| Method & path | Fungsi | Auth |
|---|---|---|
| `POST /api/orders` | buat order: union zod (`create_token`, `create_pool`, `add_liquidity`, `remove_liquidity`, `withdraw`, `swap`) + idempotency key + authorizeConfig + `kind` (`mainnet`\|`demo`, default `mainnet`) | session |
| `GET /api/orders/[id]` | status order (polling UI; embed `mint` token bila sudah ada) | session |
| `GET /api/wallet` | daftar wallet user (mainnet multi + demo, non-arsip) + wallet aktif | session |
| `POST /api/wallet` | buat wallet baru: `{action:"create_mainnet",label?}` atau `{action:"create_demo"}` (maks 1 demo) → set cookie `wid` | session + rate limit |
| `DELETE /api/wallet/[id]` | arsipkan (soft-delete) wallet non-aktif milik sendiri; wallet aktif ditolak (409, switch dulu); audit + rate limit 10/jam | session |
| `POST /api/wallet/active` | pindah wallet aktif: `{walletId}` → validasi kepemilikan + non-arsip → set cookie `wid` | session |
| `GET /api/wallet/balance` | saldo USDC/SOL on-chain wallet **aktif** (baca RPC per kind) | session |
| `POST /api/wallet/withdraw` | ajukan withdrawal + kirim OTP email (hanya wallet mainnet) | session + rate limit |
| `POST /api/wallet/withdraw/verify` | verifikasi OTP → eksekusi job withdrawal | session + rate limit |
| `POST /api/wallet/swap` | quote & execute swap Jupiter → USDC (hanya wallet mainnet; ditolak untuk demo) | session |
| `POST/GET /api/community/comments` · `DELETE` | komentar (buat/publik-baca; hapus milik sendiri) | session / publik |
| `GET/POST /api/community/watchlist` | toggle watchlist per user | session |
| `GET /api/admin/overview` | stats orders/jobs/treasury untuk panel admin | role admin |
| `GET/POST /api/admin/treasury` | GET: saldo on-chain treasury + wallet aktif admin. POST: `{action:"deposit"\|"withdraw", asset:"usdc"\|"sol", amount:string}` — transfer antara wallet aktif admin (mainnet) ↔ treasury; tujuan di-hardcode server; pre-check saldo + buffer gas; cap 50k USDC / 1k SOL; rate limit 5×/menit fail-closed; audit | role admin |
| `PATCH /api/admin/pricing` | ubah `pricing_config` (termasuk `algo_commission` = komisi flat USDC per langganan algo berbayar) | role admin |
| `GET/PATCH /api/admin/webhooks` | **5 slot URL webhook alert terpisah** (key `webhook_events|tx|wallet|algo`|`user` di `pricing_config`, value `{url}`): GET = semua URL ("" = off); PATCH `{slot,url}` — `url:""` = bersihkan; validasi `assertSafeDestUrl` (http/https, tolak localhost/IP privat); audit `webhook_configured`/`webhook_cleared`. Body kirim dibentuk **`buildWebhookEnvelope()`** (`src/lib/webhooks.ts`): Discord merender **`embeds` saja** (`content` kosong) — judul klik-able ke `url`, deskripsi hanya caption event (280 char), **maks 3 field** (amount+asset digabung; base58/UUID diringkas; `User Id`/`Kind`/`subkind`/`actor`/footer/label default dibuang), warna per slot + timestamp + `username`/`avatar_url`; receiver generik baca `text` (ringkasan + URL) & `url` top-level | role admin |
| `GET /api/discord` | URL invite Discord untuk tombol popup kanan-bawah (publik; `Cache-Control: max-age=60`; rate limit 60×/menit/IP; "" = tombol tidak dirender) | publik |
| `POST/DELETE /api/admin/users/[userId]/wallet` | **POST** `{action:"topup"\|"withdraw", asset:"usdc"\|"sol", amount, walletId?}` — transfer dompet user (mainnet) ↔ wallet aktif admin; **gas SELALU dibayar wallet admin** (feePayer; jadi withdraw USDC user tidak butuh SOL); cek saldo on-chain, cap 50k USDC/1k SOL, buffer gas 0.01 SOL, rate limit 5×/menit fail-closed, audit `admin_wallet_topup`/`admin_wallet_withdraw`. **DELETE** `?walletId=` — hapus permanen dompet user: mainnet wajib saldo hampir nol (USDC=0 & SOL<0.001, selain itu `409` — withdraw/sweep dulu); `balances_cache` (PK, tanpa FK) dihapus manual, FK lain (`orders`,`wallet_events`,…) `on delete set null`; audit `admin_wallet_deleted` | role admin |
| `DELETE /api/algos/[id]` | hapus permanen algo (**hanya admin** — moderasi konten; cascade `algo_*`: hooks/messages/subscriptions/slots; creator sendiri cukup pause via PATCH `isActive`); audit `algo_deleted` | role admin |
| `GET /api/algos` | daftar algo aktif (`?q=&page=`); `?mine=1` → milik sendiri incl. non-aktif | session opsional / session |
| `POST /api/algos` | buat algo + 1 token hook default; harga > komisi; free → billing lifetime | session + rate limit |
| `GET /api/algos/[id]` | detail + feed (`?after=<msgId>`) + mySub + counts; algo non-aktif hanya owner | publik / session opsional |
| `PATCH /api/algos/[id]` | ubah nama/deskripsi/harga/billing/isActive (owner) | session |
| `POST /api/algos/[id]/subscribe` | free = instan; paid = 1 tx split USDC (komisi→treasury, sisanya→creator, gas subscriber); mainnet only; preflight 402 | session + rate limit |
| `POST /api/algos/[id]/hook/[token]` | INGEST publik: JSON → message feed + forward inline + enqueue `algo_forward` bila gagal | token (404/409/413/429) |
| `GET/POST /api/algos/[id]/hooks` · `DELETE …/hooks/[hookId]` | CRUD token input (maks 5, owner) | session |
| `GET/POST /api/algos/[id]/slots` · `DELETE …/slots/[slotId]` | slot output subscriber (maks 3; wajib sub aktif; SSRF guard) | session |
| `DELETE /api/algos/[id]/messages/[messageId]` | hapus message (owner/admin) | session |
| `GET /api/events` | daftar event publik (urut terbaru, limit100) | publik |
| `POST /api/events` | admin posting URL + caption; meta card diambil server-side (oEmbed X / og-tags, timeout4s, SSRF guard) | role admin + rate limit |
| `DELETE /api/events/[id]` | hapus event | role admin |
| `POST /api/cron/run-jobs` | trigger manual worker (cadangan di luar GH Actions); **purge log otomatis** tiap 00:00 WITA (16:00 UTC, window 5 menit, marker anti-dobel) atau paksa `?purge=true` — hapus `jobs` done/failed + `price_snapshots` >30 hari (`src/lib/jobs/purge.ts`); pass yang sama menjalankan job queue (termasuk `webhook_alert` kirim POST + siklus `user_alert_scan` deteksi user baru via GoTrue) | `Bearer CRON_SECRET` |

**Catatan penting vs rencana awal:**
- Autentikasi 100% via **Supabase Auth SDK di client** (login/register/verify) — tidak ada route `/api/auth/*`.
- Data token & market diambil **server component + lib** (`lib/market`, query Supabase) — tidak ada `/api/tokens`, `/api/pools`, `/api/market/*` terpisah.
- **Idempotensi DELETE di UI (18 Okt):** respons **404 JSON** dari `DELETE` dianggap **sukses** di 9 aksi hapus (feed sinyal, hook, slot, komentar, event, wallet, algo) — mencegah error 404 palsu saat row sudah terhapus.
- Halaman **FAQ** (`/faq`) tanpa API — konten statis di `src/app/[locale]/faq/page.tsx`; ditautkan nav/footer + sitemap.
- `/api/webhooks/payment` (gateway) & `/api/jobs/webhook-indexer` (Helius) = opsional, **belum diimplementasikan** — deteksi topup memakai pembacaan saldo/konfirmasi tx via RPC.

---

## 6. Roadmap 7 Fase

> Semua fase menghasilkan kode yang lolos `lint + typecheck + build`. Fase F1–F5 diuji di **devnet** terlebih dahulu (flag `SOLANA_CLUSTER=devnet`), mainnet setelah spike biaya.
>
> **Status aktual (17 Okt 2026):** kode F0–F6+F-J sudah diimplementasikan dan CI hijau (`lint` · `test` 24 kasus · `typecheck` · `build`). Project Supabase live (migrasi 0001–0004), smoke devnet on-chain **lulus** (token SMOKE + pool CPMM dari site live), dan site **LIVE** di Cloudflare Workers. Sisa: spike pembanding DEX (F4), fitur gap per fitur di `docs/PRD.md` §13.

### Fase 0 — Fondasi (minggu 1)
- Repo, ESLint/Prettier, Tailwind, next-intl (`en`/`id`), design system dasar (button, input, card, badge, modal).
- Supabase: migrasi awal (profiles, wallets, RLS, trigger `handle_new_user`).
- Landing page + layout + nav/footer + halaman auth (login/register/OTP).
- CI GitHub Actions (`lint`, `typecheck`, `build`).
- **Exit:** `npm run build` sukses, register→login berjalan, wallet row + keypair tercipta otomatis.

### Fase 1 — Wallet kustodial & Topup (minggu 1–2)
- Modul `lib/solana/keypair` (generate, encrypt/decrypt AES-256-GCM).
- Halaman Wallet: alamat, QR, saldo USDC/SOL, riwayat event.
- Indexer deposit: job cron baca `getTokenAccountsByMint`/signatures → `wallet_events` + `balances_cache`.
- Rate limit & audit log dasar.
- **Exit:** kirim USDC devnet dari wallet eksternal → saldo tampil ≤ 60 detik.

### Fase 2 — Create token end-to-end (minggu 2–4)
- Wizard create token (validasi, upload logo, ringkasan harga).
- Order & state machine + pembayaran on-chain USDC → treasury + auto-refund saat gagal.
- `lib/chain/token-create`: build tx (create mint, create metadata, create ATA, mint supply, opsi revoke/immutable), kirim, konfirmasi, retry.
- Job runner GitHub Actions (`worker/run-jobs`), status polling UI, halaman riwayat order.
- **Exit (devnet):** order sukses → mint address aktif → supply 100% di wallet user → row `tokens` terisi.

### Fase 3 — Token profile & market data (minggu 4–5)
- Halaman `/token/{mint}` publik: identitas, statistik, chart (snapshot internal), supply, link explorer, JSON-LD, sitemap.
- Klien DexScreener + Jupiter Price (cache 15 detik) & snapshot tiap 1 menit.
- Explore: list, search, sort (baru/teratas), pagination.
- **Exit:** token uji tampil di explore + halaman profil dengan harga & chart.

### Fase 4 — Liquidity pool (minggu 5–7)
- **Spike (1 hari):** buat pool di devnet lewat Raydium CPMM vs Meteora DAMM v2 vs Orca → catat biaya riil → pilih pemenang (default tetap CPMM).
- Form atur **X% supply → pool / (100−X)% → market**: harga awal, pair (USDC/SOL), fee tier, preview.
- Order create pool → job → `cpmm.createPool` → LP token ke wallet user.
- Tambah & kuras likuiditas + statistik pool di halaman token.
- **Exit:** pool terbentuk, swap luar bisa (via Jupiter testnet/devnet), kuras mengembalikan aset sesuai rasio.

### Fase 5 — Swap in-app & Withdrawal (minggu 7–8)
- Jupiter `/quote`+`/swap`, server-sign, output USDC ke saldo (fee platform 0.30% dihitung server).
- Withdrawal USDC: validasi alamat, OTP email, batas harian, tx on-chain, status, audit log.
- Treasury: auto-swap USDC→SOL saat float < 0.3 SOL + alert (log) — dijalankan cron.
- **Exit:** SOL/token → USDC → withdraw ke wallet eksternal sukses; saldo konsisten.

### Fase 6 — Komunitas, admin, hardening (minggu 8–10)
- Watchlist, komentar + moderasi, profil publik user, statistik landing.
- Admin panel: order (retry/refund manual), pricing config, treasury monitor, moderasi, audit log.
- Hardening ✅ **sebagian (17–18 Okt)**: rate limit **berbasis DB** (`rate_limit_events` + RPC `rate_limit_take`, atomic lintas isolate, gagal → fail-closed), **security headers + CSP** (`next.config.ts`), input validation (zod), `npm audit`. Sisa: error boundary menyeluruh, empty/loading state pass, moderasi komentar & suspend di UI, audit log viewer.
- SEO: sitemap lengkap, OG image per token, metadata ID/EN; a11y pass.
- **Exit:** checklist QA Fase 6 lulus; siap deploy production.

---

## 7. Strategi Testing
| Tipe | Alat | Cakupan |
|---|---|---|
| Unit ✅ | Vitest | pricing calculator (create_token/pool/add/remove/withdraw + swap fee), format (raw USDC/angka), resolusi jaringan per-kind (`network.test.ts`: cluster/USDC-mint/treasury demo) & **envelope webhook** (`webhooks.test.ts`: `content` kosong (Discord embed-only), `text`+`url` utk receiver generik, field disaring maks3 + hashing diringkas, **payload asli per sub-jenis `tx`**, URL per slot, batas 2000 char) — **hijau (44 kasus)** |
| Unit (tertunda) | Vitest | enkripsi AES-GCM, state machine order, validasi input |
| Integration (tertunda) | Vitest + mock RPC | token-create tx builder (assert instruksi), withdrawal flow |
| E2E manual (tertunda) | `scripts/devnet-smoke.ts` | topup→create token→pool→swap→withdraw di devnet |
| E2E live ✅ | `scripts/e2e-admin-test.py` + `scripts/e2e-algo-test.py` | sesi magiclink→cookie SSR: admin wallet/treasury + **ops dompet user (topup/withdraw/hapus), hapus algo, purge cron, webhook5 slot (set/clear/SSRF + delivery live via job → postman-echo + set/clear discord)** (46 cek) & **algo marketplace** (50 cek) — lulus penuh di live; smoke terpisah **events+landing+nav 19/19** (hero/blok fitur baru, urut nav Algos→Create→Explore→Events, CRUD event admin + og-meta, SSRF/caption guard) |
| Uji live webhook ✅ (manual, 18 Okt) | webhook.site sbg penangkap | 5 slot dialihkan sementara lalu dipicu jalur **asli**: `events` (`POST /api/events` sbg admin), `wallet` (`POST /api/wallet` sbg user), `user` (job siklis `user_alert_scan`), `algo` + **5 sub-jenis `tx`** (job `webhook_alert` berpayload persis pemanggil; jalur berbayar sengaja tidak dipicu agar dana tak tersentuh). **9 payload lolos**: `content` kosong, judul link, field ≤3, hash diringkas, timestamp ada, tanpa footer. Menemukan & memperbaiki **mapping key `tx`** (`amountRaw`/`priceRaw`/`service`/`tx` — nominal sempat tidak tampil) dan **duplikasi alert `user` 3×** (marker kini disimpan + diverifikasi **sebelum** mengumumkan; gagal → `throw`). Konfigurasi & data uji dipulihkan penuh |
| CI ✅ | GitHub Actions `ci.yml` | `lint`, `test`, `typecheck` (`next typegen && tsc`), `build` tiap push/PR — Node 22 |
| Post-deploy | worker cron tiap menit | sentuh DB tiap menit (de facto heartbeat, PRD §10 R5) + jalankan job siklis `price_snapshot` |

Definisi selesai per fase: **CI hijau + exit criteria fase terpenuhi** (exit on-chain/devnet masih tertunda — lihat blok status §6).

---

## 8. Deployment & Konfigurasi
1. Supabase project live `vysgkjqbmgbbowsxafok` → migrasi **`0001_init` … `0010_webhooks`** (0005 rate_limit, 0006 burn, 0007 wallet_archive, 0008 algo, 0009 events, 0010 webhooks — 0008–0010 dijalankan manual via SQL Editor karena `db push` mentok history remote timestamped; lainnya via MCP `apply_migration` / `supabase/apply_all.sql`) → URL + anon key + service role key di `.env`.
2. **Deploy aktual (Cloudflare Workers, bukan Pages):** `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=32532cb4cb1b252afd68622061ab20c2 npm run deploy:cf` — wrapper `scripts/cf-deploy.mjs` (re-exec Node 22 utk macOS < 13.5) menjalankan `wrangler deploy`; `wrangler.jsonc` memuat `build.command: opennextjs-cloudflare build` sehingga build selalu dijalankan sebelum upload (mencegah deploy stale). Live: <https://artian-capital-group.trading-ekaryan.workers.dev>.
3. **Worker secrets** (`wrangler secret put <NAME>`): `SUPABASE_SERVICE_ROLE_KEY`, `WALLET_MASTER_KEY`, `TREASURY_SECRET_KEY`, `CRON_SECRET`, `HELIUS_API_KEY`, `JUPITER_API_KEY`. Var `NEXT_PUBLIC_*` **inlined saat build** dari `.env` (tidak perlu secret). Opsional: `RESEND_API_KEY` (dibatalkan), `TREASURY_SECRET_KEY_DEMO` (fallback ke treasury utama).
4. GitHub Actions secrets: sama dengan poin 3 (lihat daftar di `.github/workflows/worker.yml` — worker dijalankan `npx tsx src/worker/run-jobs.ts` tiap menit).
5. Custom domain (opsional) — saat ini memakai `*.workers.dev`; zona/domain tidak wajib.
6. Checklist production: RLS aktif (cek `supabase_get_advisors`) ✅, **CSP & security headers ✅** (`next.config.ts`,17 Okt), **rate limit ✅** (berbasis DB, atomic lintas isolate), backup DB (pg_dump mingguan via cron), monitoring saldo treasury, **leaked password protection** (Supabase Auth → Password), smoke devnet → mainnet ✅ (`NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`,17 Okt).

---

## 9. Tabel Biaya Operasional
| Item | Biaya platform | Ditalangi user via |
|---|---|---|
| Hosting, DB, auth, storage, RPC, data pasar, job runner | **$0** | — |
| Gas on-chain semua transaksi (fee & rent) | **$0** — dibayar user dari saldo SOL miliknya (platform tidak mendanai gas) | — (user deposit SOL sendiri) |
| Metadata permanen (Arweave) — opsional F7 | ~$0.01–0.10/token | biaya create token |

---

## 10. Risk Register (ringkas — detail di PRD §10)
R1 kebocoran key · R2 gas habis · R3 breaking change DEX · R4 rate limit API · R5 Supabase pause · R6 ToS hosting · R7 regulasi · R8 spam · R9 kegagalan on-chain pasca bayar · R10 metadata tidak permanen.

---

## 11. Fase Pasca-MVP (F7+, tidak dikerjakan sekarang)
Upgrade metadata Arweave · holder stats & top wallets · fiat on-ramp (QRIS dsb., setelah tinjauan ToS) · export private key (dengan keamanan tambahan) · CLMM/full-range pools · forum komunitas · multi-chain · mobile app.
