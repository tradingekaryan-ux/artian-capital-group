# PRD — Artian Capital Group
## Platform Komunitas Financial Market & Solana Token Launcher

| | |
|---|---|
| **Versi** | 1.1 |
| **Tanggal** | 16 Oktober 2026 |
| **Status** | Kode Fase 1 selesai — `lint + typecheck + test + build` hijau; verifikasi devnet & deploy menyusul |
| **Penyesuaian** | Disesuaikan dengan implementasi aktual (lihat §13) |
| **Layanan fase 1** | Pembuatan token crypto (Solana) + Liquidity Pool + Market Data |
| **Target pasar** | Global (Bahasa Inggris & Bahasa Indonesia) |
| **Model biaya infrastruktur** | $0/bulan (tier gratis, aman untuk site komersial) |

---

## 1. Latar Belakang & Positioning

### 1.1 Masalah
Membuat token di Solana hari ini menuntut user:
1. Memahami wallet crypto, menyiapkan SOL untuk gas, dan menyimpan seed phrase sendiri.
2. Melalui beberapa situs terpisah (token creator → DEX → chart/stats) untuk meluncurkan satu token.
3. Membayar biaya yang tidak transparan (platform fee, gas, rent) dalam SOL.

Bagi komunitas financial market yang bukan crypto-native, hambatan di atas membuat proses peluncuran token terasa berisiko dan rumit.

### 1.2 Solusi
Satu website tempat user:
- **Membuat akun biasa** (email) — **tanpa membuat/menghubungkan wallet**. Sistem otomatis membuat **1 wallet Solana khusus untuk 1 akun** (kustodial).
- **Membayar dan dihargai dalam USDC on-chain** (topup dari exchange/wallet eksternal, saldo berakhir di wallet milik user sendiri), lalu menarik kembali (**withdrawal**) dalam USDC kapan saja.
- **Membuat token Solana** (SPL + metadata) lewat satu form, langsung dibayar dari saldo.
- **Melihat token buatannya** beserta halaman profil publik otomatis: harga, statistik, chart, likuiditas.
- **Mengatur liquidity pool** langsung di web: berapa persen supply masuk ke pool, berapa persen sisanya untuk market, menambah dan **menguras** likuiditas tanpa pindah situs.

### 1.3 Positioning
> "Launch, list, and manage your Solana token — all in one place. No wallet setup. No juggling five tabs."

- **Bukan** exchange/broker (tidak memfasilitasi jual-beli aset antar user).
- **Bukan** penasihat investasi / platform iming-iming return.
- **Adalah** tooling & komunitas: pembuatan token, manajemen likuiditas, dan data pasar.

### 1.4 Prinsip Produk
1. **Zero wallet friction** — user tidak pernah melihat seed phrase.
2. **All-in-one** — token, profil, market data, LP dalam satu website.
3. **Biaya semurah mungkin, tetap ditanggung pembuat token** — harga transparan, tanpa biaya tersembunyi, tanpa fee gateway pihak ketiga.
4. **Transparan on-chain** — semua aksi menghasilkan transaksi yang bisa diverifikasi publik.
5. **Gratis untuk dijalankan** (infra) — biaya operasional ditalangi oleh biaya layanan yang dibayar user.

---

## 2. Tujuan & Metrik Sukses

### 2.1 Tujuan produk (6 bulan pertama)
| # | Tujuan | Metrik | Target |
|---|---|---|---|
| G1 | Token berhasil dibuat | Success rate order `confirmed` | ≥ 97% |
| G2 | Aktivasi user | % user baru yang menyelesaikan create token dalam 7 hari | ≥ 15% |
| G3 | Likuiditas terbentuk | % token yang punya LP pool dalam 14 hari | ≥ 50% |
| G4 | Retensi komunitas | User aktif bulanan (login / punya aksi on-chain) | naik MoM |
| G5 | Operasional sehat | Biaya infra bulanan | $0 (tier gratis) |

### 2.2 Anti-goals (yang TIDAK kita kejar)
- Volume trading harian platform (kami bukan venue perdagangan).
- Jumlah token sebanyak mungkin tanpa kualitas (akun spam justru ditekan).

---

## 3. Persona

| Persona | Kebutuhan | Hambatan utama |
|---|---|---|
| **P1 — Token Creator** (utama): developer/kreator komunitas yang ingin meluncurkan token proyeknya | Cepat, murah, sekali jalan: token + profil + LP | Tidak paham wallet/gas/DEX terpisah |
| **P2 — Trader/Watcher**: anggota komunitas financial market | Data harga, chart, statistik, likuiditas yang jelas | Data tersebar di situs lain |
| **P3 — Admin platform**: operator website | Kelola harga layanan, treasury, moderasi, monitoring | Butuh visibilitas biaya on-chain |

---

## 4. Ringkasan Fitur (Fase 1 — Full Scope)

### F-A. Akun & Autentikasi
- Registrasi email + verifikasi OTP, login, lupa password, sesi (refresh token).
- **Setelah akun dibuat, wallet Solana dibuat otomatis** (keypair baru, 1:1 dengan akun).
- Halaman **Wallet** menampilkan: alamat public, saldo USDC, riwayat transaksi on-chain, tombol *Copy / Explorer*.
- **Private key tidak pernah ditampilkan atau diekspor** di fase 1 (non-exportable).

### F-B. Topup (Deposit USDC)
- User mengirim USDC (mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyBTv` di **jaringan Solana**) ke alamat wallet miliknya.
- Saldo terdeteksi otomatis (polling/indexer + konfirmasi) dan langsung terpakai untuk membayar layanan.
- Tampil ringkasan: alamat deposit, QR alamat, riwayat deposit, status konfirmasi.
- **Tanpa gateway pihak ketiga, tanpa fee deposit.**

### F-C. Pembuatan Token (layanan utama)
Form satu halaman:
| Field | Ketentuan |
|---|---|
| Name | wajib, ≤ 32 char |
| Symbol | wajib, 3–10 char (uppercase) |
| Decimals | default 9 |
| Total supply | wajib, > 0, format ribuan |
| Logo | wajib, gambar ≤ 2 MB (PNG/JPG/WEBP) |
| Deskripsi | opsional |
| Socials (website, X, Telegram, Discord) | opsional |
| **Revoke mint authority** | opsional, disarankan ON (supply tetap) |
| **Revoke freeze authority** | opsional, disarankan ON |
| **Metadata immutable** | opsional |

Hasil on-chain: mint account (Token Program), Metaplex Token Metadata (nama/logo/deskripsi/URI), ATA user + seluruh supply di-mint ke wallet user.
- **Payer semua transaksi = treasury platform** (user tidak butuh SOL).
- **Mint & freeze authority = wallet user** (user yang berwenang me-revoke nanti).
- Metadata disimpan sebagai JSON + gambar di storage (Supabase Storage) → URI on-chain.
- Setelah `confirmed`, **halaman profil token dibuat otomatis** (`/token/{mint}`).

### F-D. Halaman Profil Token (otomatis, per token)
Publik, SEO-friendly, memuat:
- Identitas: nama, symbol, logo, deskripsi, socials, alamat mint (copy + link explorer).
- **Statistik pasar**: harga, perubahan 1j/24j, FDV, likuiditas, volume 24j, jumlah transaksi 24j, ATH/ATL.
- **Chart harga** (rentang 1j/24j/7d/30d) dari snapshot internal + data agregat DEX.
- **Info liquidity pool**: pair, ukuran pool, fee tier, harga pool, status LP.
- Supply & distribution: total supply, supply di LP, supply beredar.
- Tombol **"Buat token serupa"** + link share.
- Sumber data: DexScreener API, Jupiter Price API, pembacaan on-chain (RPC), snapshot internal.

### F-E. Liquidity Pool (semua dari dalam website)
Kontrol penuh atas pembagian supply:
```
Total supply token
├── X%   → Liquidity Pool (pair TOKEN/USDC, default)  ← user atur di slider/input
└── (100−X)% → Wallet creator sebagai market/circulating supply
```
- **Buat pool**: pilih pair (USDC default, SOL opsional), **harga awal** (dihitung dari rasio yang dimasukkan), fee tier, lalu konfirmasi → pool dibuat on-chain (Raydium CPMM), LP token masuk ke **wallet user**.
- **Tambah likuiditas**: nominal token + quote (USDC/SOL) mengikuti rasio pool saat ini; preview jumlah LP yang diterima.
- **Kuras likuiditas (withdraw LP)**: masukkan % posisi → preview kedua aset yang ditarik → konfirmasi → aset kembali ke wallet user.
- **Statistik pool** tampil di halaman token: TVL, harga, volume, fee terkumpul, share LP user.
- Semua aksi LP **dibayar dari saldo USDC user**, gas ditanggung treasury.

### F-F. Swap In-App (pendukung withdrawal)
- Karena **withdrawal hanya menerima USDC**, user harus bisa mengubah SOL/token SPL miliknya menjadi USDC langsung di website.
- Quote dari Jupiter Aggregator, server yang menandatangani transaksi, output USDC masuk ke saldo wallet.
- Mendukung: SOL → USDC, token SPL → USDC.

### F-G. Withdrawal (penarikan)
- **Hanya USDC** ke alamat tujuan mana pun (jaringan Solana).
- Alur: input alamat + jumlah → validasi alamat & saldo → **konfirmasi OTP email** → transaksi dikirim → status `pending → confirmed`.
- Fee withdrawal dikonfigurasi admin (default: biaya jaringan, dapat ditambah markup kecil).
- Batas: minimum, maksimum harian, dan whitelist opsional (fase lanjut).
- Semua penarikan tercatat di **audit log** (siapa, kapan, ke mana, berapa, tx signature).

### F-H. Komunitas & Discovery
- **Explore**: daftar semua token yang dibuat di platform — filter *baru / teratas (gainers) / terpopuler*, pencarian nama/symbol/mint.
- **Watchlist** per user (tambah/hapus token).
- **Komentar** ringkas di halaman token (moderasi: filter kata + lapor + hapus oleh admin).
- **Profil publik user** (username, token yang dibuat, bergabung sejak).
- Statistik platform di landing page: total token, total TVL, total user.

### F-I. Admin Panel (minim)
- Daftar order & status (manual retry/refund).
- Konfigurasi harga layanan (mis. create token, buat LP, fee withdrawal, fee swap).
- Monitoring treasury: saldo SOL (float gas) & USDC, riwayat pengeluaran.
- Moderasi komentar & user (suspend).
- Log audit.

---

## 5. Alur Transaksi & State Machine

### 5.1 Order layanan
```
awaiting_payment ──(transfer USDC on-chain ke treasury terkonfirmasi)──▶ paid
paid ──(job antri)──▶ processing ──(tx sukses)──▶ confirmed ──▶ token profile dibuat
                                  └──(tx gagal)──▶ failed ──(auto refund USDC)──▶ refunded
(order yang dibatalkan sebelum diproses bisa berstatus cancelled)
```
- Untuk layanan **swap**: tanpa pembayaran di muka — fee platform (0.30%) dipotong dari hasil swap di dalam job, sehingga state `paid` terjadi setelah swap dieksekusi.
- Idempotensi: setiap order punya `payment_signature` / `idempotency_key` unik; replay tidak boleh memproses dua kali.
- Retry: job gagal karena RPC timeout di-retry maksimal 3× dengan backoff sebelum `failed`.

### 5.2 Withdrawal
```
requested ──(OTP benar)──▶ processing ──(tx sukses)──▶ confirmed
                              └──(gagal)──▶ failed (saldo tidak berkurang)
```

### 5.3 Deteksi topup
- Sumber kebenaran = saldo on-chain (ATA USDC milik wallet user).
- Indexer membaca mutasi ATA (polling RPC + konsolidasi ke tabel `wallet_events`), saldo di-cache per user untuk keperluan UI & rate-limit anti double-spend.

---

## 6. Model Harga (semurah mungkin, seluruhnya ditanggung pembuat token)

> Semua harga dikonfigurasi admin, disimpan di tabel `pricing_config`, dan ditampilkan sebelum user membayar.

### 6.1 Komponen biaya nyata (on-chain, dibayar treasury, dibebankan ke user)
| Komponen | Perkiraan biaya on-chain |
|---|---|
| Create token (mint + metadata + ATA + supply) | ≈ 0.010–0.020 SOL (rent 165-byte mint ≈ 0.0015 SOL, metadata ≈ 0.005–0.01 SOL, ATA ≈ 0.002 SOL, fee & priority kecil) |
| Buat pool liquidity (CPMM) | ≈ 0.2 SOL (rent pool + vault, sesuai catatan resmi Raydium) — diverifikasi ulang di spike Fase 4 terhadap Meteora/Orca |
| Tambah / kuras likuiditas | fee jaringan saja (≈ 0.00001–0.001 SOL dengan priority) |
| Swap (Jupiter) | fee jaringan + fee pool DEX |
| Transfer USDC (bayar layanan / withdrawal) | ≈ 0.000005 SOL |

### 6.2 Harga contoh ke user (dalam USDC)
| Layanan | Harga | Catatan |
|---|---|---|
| Create token | **2 USDC** | sudah termasuk seluruh biaya on-chain + margin tipis |
| Buat liquidity pool | **10 USDC** + dana LP (dari saldo user) | biaya rent pool besar → ditanggung penuh user |
| Tambah likuiditas | **1 USDC** | flat |
| Kuras likuiditas | **Gratis** | gas sudah tercakup margin |
| Swap in-app | **0.30%** dari nilai swap (min 0.05 USDC) | mencakup gas treasury + likuiditas route |
| Withdrawal USDC | **0.50 USDC** flat | di atas biaya jaringan |
| Topup | **Gratis** | |

Rumus dasar harga:
```
harga_user = (biaya_on_chain_USDC × (1 + buffer_gas)) + margin_platform
buffer_gas default 15% (fluktuasi harga SOL & priority fee)
```

### 6.3 Operasional treasury
- Treasury = hot wallet platform (terpisah dari wallet user) sebagai **fee payer** semua transaksi.
- Float SOL treasury dijaga oleh **auto-swap USDC→SOL** (Jupiter) saat saldo SOL < ambang batas.
- Pendapatan platform (USDC di treasury) ditarik manual oleh admin via private key di environment (fase 1, operasi manual).

---

## 7. Requirements Non-Fungsional

### 7.1 Keamanan (kustodial = tanggung jawab paling berat)
| Kebutuhan | Implementasi wajib |
|---|---|
| Kerahasiaan private key | Enkripsi AES-256-GCM, master key hanya di secret environment (tidak pernah di repo/log) |
| Isolasi | Private key tidak pernah dikirim ke client, tidak muncul di API response, tidak di-log |
| Akses | Semua endpoint mutasi wajib session; RLS Supabase per user; role `admin` terpisah |
| Penarikan dana | Konfirmasi OTP email, validasi alamat, audit log, rate limit per user/IP |
| Anti-abuse | Rate limit (registrasi, order, cek saldo), idempotency key, validasi input ketat |
| Supply chain | Pin dependensi, `npm audit` saat CI, tanpa dependensi eksotis di jalur signing |
| Transparansi | Setiap aksi menyimpan `tx_signature` yang bisa diverifikasi publik |

### 7.2 Performa & Skala
- Halaman publik dirender dinamis (SSR) dengan cache market data 15 detik; ISR `revalidate` dinonaktifkan pada implementasi saat ini (kompatibel dengan mode render Next 16 yang dipakai).
- Snapshot harga tiap 1 menit + job siklis (treasury rebalance, index wallet) dijalankan worker GitHub Actions (cron per menit) — cron ini sekaligus menjadi heartbeat DB (menyentuh DB tiap menit, §10 R5).
- RPC: Helius free (10 RPS) dengan fallback publik + exponential backoff.
- Semua pekerjaan berat (build tx, kirim, konfirmasi) berjalan **asinkron** lewat job queue — request user tidak pernah menunggu konfirmasi on-chain.

### 7.3 Internasionalisasi
- Dua bahasa: `en` (default) & `id`, rute ber-prefix (`/id/...`), semua string via message catalog.
- Mata uang tampil: USDC (utama), perkiraan nilai fiat opsional.

### 7.4 SEO & Aksesibilitas
- Metadata + OpenGraph per halaman token, `sitemap.xml`, `robots.txt`, JSON-LD (`DigitalAsset` / `WebPage`).
- Aksesibilitas: kontras memadai, fokus keyboard, label form, `aria-live` untuk status proses on-chain.

### 7.5 Kepatuhan & Legal (ringkas — perlu tinjauan hukum ahli)
- Situs menyertakan **disclaimer**: bukan penasihat investasi; token berisiko tinggi; transaksi on-chain bersifat final.
- Positioning sebagai **tooling**, bukan penawaran investasi / imbal hasil.
- Fitur komunitas dimoderasi (larangan: penipuan, judi, promosi bodong).
- Jika berkaitan pengguna Indonesia: regulasi aset kripto berada di ranah OJK/Bappebti — **mitigasi**: orientasi pasar global, tanpa fitur spekulasi/imbal hasil, kebijakan geo-opsional ditinjau di fase pasca-MVP.

---

## 8. Data Model Ringkas (sesuai `supabase/migrations/0001_init.sql`)

```
profiles            — user_id pk→auth.users, username, display_name, bio,
                      role(user|admin), is_suspended, created_at
wallets             — user_id pk→profiles, public_key, enc_secret_key, iv, auth_tag
balances_cache      — user_id pk, usdc_raw, sol_lamports, refreshed_at
wallet_events       — user_id, type(deposit|payment|withdrawal|swap|refund|lp),
                      mint, amount_raw, signature, meta, confirmed_at
orders              — user_id, service(create_token|create_pool|add_liquidity|
                      remove_liquidity|withdraw|swap), amount_raw,
                      status(awaiting_payment|paid|processing|confirmed|failed|
                      refunded|cancelled), pricing, config, payment_signature,
                      idempotency_key, tx_signature, error
tokens              — user_id, mint, order_id, name, symbol, decimals, supply,
                      logo_uri, metadata_uri, description, socials,
                      revoke_mint, revoke_freeze, immutable,
                      status(pending|live|failed), created_tx
pools               — user_id, token_id, dex(raydium_cpmm), pool_id, quote_mint,
                      fee_tier, initial_price, lp_percentage, lp_raw,
                      token_amount, quote_amount, status, created_tx
pool_positions      — user_id, pool_id, lp_raw, deposited_token, deposited_quote
price_snapshots     — mint, ts, price_usd, liquidity_usd, volume_24h_usd, fdv_usd
watchlists          — user_id, mint
comments            — user_id, mint, body, status(active|hidden)
withdrawals         — user_id, amount_raw, destination,
                      status(pending|processing|confirmed|failed),
                      otp_hash, otp_expires_at, tx_signature, error
audit_logs          — actor, action, target, payload, ip
pricing_config      — key, value(jsonb), updated_by, updated_at
jobs                — type(create_token|create_pool|add_liquidity|remove_liquidity|
                      withdraw|swap|index_wallet|price_snapshot|
                      treasury_rebalance|refund),
                      status(pending|running|done|failed), attempts, run_at, last_error
```

---

## 9. Asumsi & Open Questions

| # | Asumsi / Pertanyaan | Status |
|---|---|---|
| A1 | "Persen di liquidity pool vs dilengkap ke market" = X% supply masuk pool, (100−X)% menjadi circulating/market di wallet creator | Asumsi disepakati; bisa diubah jadi "sisa di-hold platform" bila diperlukan |
| A2 | Nama brand sementara **Artian Capital Group** | Placeholder, mudah diganti |
| A3 | Pair default pool = TOKEN/USDC | Disepakati; TOKEN/SOL jadi opsi |
| A4 | Withdrawal **hanya USDC** (SOL/token wajib swap dulu) | Disepakati |
| A5 | Gas ditanggung treasury, dibebankan ke user lewat harga USDC | Disepakati |
| Q1 | Perlu export private key di kemudian hari? | Ditunda — fase lanjut, dengan KYC/keamanan tambahan |
| Q2 | Perlu fiat on-ramp (mis. QRIS) untuk user tanpa USDC? | Fase lanjut, setelah tinjauan ToS gateway & risiko regulasi |

---

## 10. Risiko & Mitigasi

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Kebocoran master key / hot wallet | Kehilangan dana user | Enkripsi ketat, secret hanya di env, pisahkan treasury & key user, audit log, monitoring saldo, siapkan prosedur rotasi & pemindahan dana |
| R2 | Jumlah SOL treasury (gas) habis | Order tertahan | Auto-swap USDC→SOL, alert ambang batas, retry queue |
| R3 | Perubahan program DEX (Raydium) / SDK breaking | Fitur LP rusak | Pin versi SDK, adapter layer, spike pembanding (Meteora/Orca), uji di devnet |
| R4 | Rate limit RPC/Jupiter/DexScreener | Data/loading gagal | Fallback provider, cache, backoff, snapshot internal |
| R5 | Supabase free di-pause (7 hari sepi) | Site down | Cron heartbeat menulis DB ≥ 1×/jam; jalur upgrade ke Pro saat revenue |
| R6 | ToS tier gratis (hosting) melarang komersial | Deployment dihapus | Pilih Cloudflare (boleh komersial); Vercel Hobby sengaja tidak dipakai |
| R7 | Regulasi kripto (khususnya pengguna ID) | Pemblokiran/hambatan hukum | Positioning tooling global, disclaimer, tanpa janji imbal hasil, tinjauan hukum sebelum skala |
| R8 | Spam/akun-abuse menyalahgunakan platform | Reputasi & biaya | Rate limit, verifikasi email, moderasi komentar, flag token berbahaya |
| R9 | Kegagalan on-chain setelah user bayar | Trust turun | State machine + auto-refund + status transparan + retry 3× |
| R10 | Metadata tidak permanen (storage gratis) | Gambar/deskripsi token bisa hilang | Kontrak uptime storage, upgrade Arweave/Irys (berbayar kecil) di fase lanjut |

---

## 11. Out of Scope (Fase 1)
- Trading/swap antar user di dalam platform (order book, kurs sendiri).
- Fitur imbal hasil, staking, farming, atau janji return.
- Multi-chain (hanya Solana).
- Export/import private key wallet.
- KYC, fiat on-ramp, custody berlisensi.
- Mobile native app (web responsive saja).
- Forum diskusi penuh (komentar ringkas sudah cukup untuk MVP).

---

## 12. Dokumen Terkait
- `docs/IMPLEMENTATION_PLAN.md` — tech stack, skema DB, API, roadmap 7 fase, testing, deployment.

---

## 13. Status Implementasi & Deviasi (16 Oktober 2026)

Kode seluruh fase (F0–F6) telah diimplementasikan; `lint + typecheck + test (10 kasus) + build` hijau; CI (`ci.yml`) & worker cron (`worker.yml`) aktif. Database Supabase `vysgkjqbmgbbowsxafok` sudah live (migrasi + seed pricing lewat MCP `apply_migration`); smoke test lokal lulus (auth → auto-`profiles`/`wallets`, explore/token/dashboard/admin, signup email SMTP Supabase). Sisa pekerjaan yang menuntut resource eksternal: pendanaan devnet (Helius key + airdrop treasury), spike F4, deploy GitHub/Cloudflare Pages.

| Area (referensi §) | Status | Catatan deviasi / gap |
|---|---|---|
| F-A: register + OTP + login + sesi | ✅ Selesai | — |
| F-A: wallet otomatis 1:1 dengan akun | ✅ Selesai | Dibuat via `ensureProfile`/`ensureWallet` di aplikasi (bukan trigger DB `handle_new_user`) |
| F-A: lupa password | ❌ Belum | Jalur reset password belum dibuat |
| F-B: topup & saldo otomatis | ✅ Selesai | Baca saldo on-chain + konfirmasi tx → `wallet_events`; **QR deposit belum ada**; scan riwayat penuh membutuh Helius (tanpa itu keterbatasan RPC publik) |
| F-C: create token end-to-end | ✅ Selesai | Payer treasury, mint/freeze authority → wallet user (revoke opsional), immutable opsional, metadata di Storage |
| F-D: halaman profil token | ✅ Selesai | `generateMetadata` + OG, chart, statistik, panel pool, komentar, watchlist |
| F-D/§7.4: JSON-LD, `sitemap.xml`, `robots.txt` | ✅ Selesai | `robots.txt` (blok `/api/`, admin, verify), `sitemap.xml` (static ×2 locale + token live dari DB), JSON-LD `WebSite`+`SearchAction` di layout & `WebPage`+`Offer` di halaman token |
| F-E: liquidity pool (Raydium CPMM) | ⚠️ Sebagian | Pair **USDC** berfungsi; **SOL sebagai quote belum tersedia di UI** (backend generik). Fee tier di UI masih default 0.25% (API menerima 1–100 bps). Spike pembanding Meteora/Orca (exit F4) tertunda |
| F-F: swap in-app (Jupiter) | ✅ Selesai | Fee 0.30% (min 0.05) dipotong dari hasil swap saat job |
| F-G: withdrawal USDC + OTP + audit | ✅ Selesai | Batas harian/whitelist = fase lanjut (sesuai §F-G) |
| F-H: explore, watchlist, komentar, statistik | ✅ Selesai | **Profil publik user** (per-user halaman) belum ada |
| F-I: admin panel | ⚠️ Sebagian | Overview, pricing, daftar order, jobs, treasury ✅; **manual retry/refund, moderasi komentar, suspend, viewer audit log belum ada di UI** |
| §7.2 ISR | ⚠️ Deviasi | Implementasi memakai SSR dinamis + cache market 15 detik (ISR tidak dipakai) |
| §5.1 state machine | ⚠️ Deviasi | Tidak ada status `draft`; ada `cancelled`; swap tanpa bayar di muka (lihat §5.1 yang diperbarui) |
| Exit criteria on-chain (F1/F2/F4/F5) | ⛔ Belum dijalankan | Butuh project Supabase, secret treasury/RPC, dan jaringan devnet |
