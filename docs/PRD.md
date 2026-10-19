# PRD — Artian Capital Group
## Platform Komunitas Financial Market & Solana Token Launcher

| | |
|---|---|
| **Versi** | 1.3 |
| **Tanggal** | 18 Oktober 2026 |
| **Status** | **LIVE** di Cloudflare Workers; smoke on-chain devnet lulus; mode demo + multi-wallet (**buat wallet tanpa prompt label — nama otomatis + ganti nama inline**); **treasury deposit/withdraw USDC+SOL di admin panel**; **algo marketplace + event tracker + webhook alert 6 slot (format teks tanpa embed → kartu link dari Discord) + tombol Discord + halaman FAQ**; migrasi `0001–0010`; `lint + typecheck + test (50) + build` hijau |
| **Penyesuaian** | Disesuaikan dengan implementasi aktual (lihat §13) |
| **Layanan fase 1** | Pembuatan token crypto (Solana) + Liquidity Pool + Market Data |
| **Target pasar** | Global — **Bahasa Inggris saja** (keputusan 17 Okt: `messages/` hanya `en.json`, URL tanpa prefix; `messages/id.json` dihapus) |
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
- **Membuat akun biasa** (email) — **tanpa membuat/menghubungkan wallet**. Sistem otomatis membuat **1 wallet Solana khusus untuk 1 akun** (kustodial); user juga bisa membuat **banyak wallet mainnet tambahan** dan **1 wallet demo (devnet)** untuk berlatih (§4 F-J).
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
- Registrasi email + verifikasi OTP, login, sesi (refresh token). **Tanpa reset password** (keputusan 17 Okt — layanan email Resend tidak dipakai).
- **Batas registrasi**: SMTP default Supabase ≈ **3 user/jam** — halaman register menampilkan notifikasi batas ini, dan error rate limit dipetakan ke pesan ramah (en/id).
- **Setelah akun dibuat, wallet Solana dibuat otomatis** (keypair baru, 1:1 dengan akun).
- Halaman **Wallet** menampilkan: alamat public, saldo USDC, riwayat transaksi on-chain, tombol *Copy / Explorer*.
- **Private key tidak pernah ditampilkan atau diekspor** di fase 1 (non-exportable).

### F-B. Topup (Deposit USDC & SOL)
- User mengirim **USDC** (mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyBTv` di **jaringan Solana**) ke alamat wallet miliknya untuk membayar layanan, dan **SOL** untuk gas on-chain (transaksi dibayar oleh wallet user sendiri).
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
- **Gas on-chain (fee & rent) dibayar dari saldo SOL milik user** — wallet user adalah fee-payer transaksinya sendiri; platform tidak perlu mengisi/menanggung gas (preflight cek saldo SOL sebelum order dibuat).
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
- Semua aksi LP **dibayar dari saldo USDC user**, gas dibayar dari saldo SOL user.

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
- Monitoring & pengelolaan treasury: saldo on-chain real-time (SOL + USDC) + **deposit/withdraw USDC & SOL dari panel** (`POST /api/admin/treasury`) — tujuan withdraw & sumber deposit selalu **wallet aktif admin (mainnet)**, ditentukan server (bukan input alamat bebas); pre-check saldo + pesan jelas; rate limit 5×/menit fail-closed; audit log. Withdraw dibayar gas-nya oleh treasury (treasury wajib punya SOL — deposit SOL dulu bila habis).
- Daftar user: detail menampilkan **semua wallet termasuk yang terarsip** (badge Archived).
- Moderasi komentar & user (suspend).
- Log audit.

### F-J. Mode Demo (Devnet) & Multi-Wallet
Tujuan: user bisa **belajar** membuat token & liquidity pool di jaringan uji sebelum memakai dana sungguhan.
- **Multi-wallet**: setiap user dapat membuat **banyak wallet mainnet** (nama otomatis `Wallet 1/2/…`, tampil di daftar switcher — tanpa prompt label) dan **maksimal 1 wallet demo (devnet)**. **Ganti nama inline** (tombol ✎ per baris → input inline, Esc/✕ batal; `PATCH /api/wallet/[id]`, label wajib non-kosong maks 40 char, audit `wallet_renamed`) — berlaku juga untuk wallet aktif & terarsip. Wallet aktif dipilih lewat switcher di dashboard (cookie `wid`); saldo, token, dan orders mengikuti wallet aktif.
- **Arsip wallet (soft-delete, 18 Okt)**: user bisa mengarsipkan wallet non-aktif (tombol ✕) — `wallets.archived_at` diisi, wallet hilang dari daftar & tidak bisa jadi aktif (dicek di `getActiveWallet` + switch route; cookie basi lintas-device diabaikan). Wallet **aktif tidak bisa diarsipkan** — guard memakai resolusi `getActiveWallet()` (cookie `wid` ATAU fallback mainnet pertama; cek cookie saja TIDAK cukup karena cookie bisa absen — terbukti saat E2E live, sudah diperbaiki). Wallet terarsip **tetap terlihat di dashboard admin** (badge Archived). Indeks unik demo hanya menghitung wallet non-arsip — mengarsipkan demo membebaskan kuota "1 demo" untuk membuat yang baru. Untuk admin, daftar wallet di dashboard juga menampilkan **entri virtual "Treasury wallet"** (display-only: tanpa switch, tanpa arsip).
- **Wallet demo = sandbox Devnet**:
  - Deposit **manual**: user menyalin alamat wallet demo lalu meminta (faucet) SOL & USDC devnet dari situs eksternal — `faucet.solana.com` (SOL) dan `faucet.circle.com` (USDC, jaringan Solana Devnet) — dengan menempel alamat wallet sendiri. Tanpa deposit otomatis, tanpa airdrop in-app.
  - Layanan yang tersedia: **create token → create pool → add/remove liquidity** (harga sama dengan mainnet, dibayar dengan **USDC devnet**).
  - **Tanpa withdraw & tanpa swap** (Jupiter tidak mendukung devnet; WD/SOL tidak berharga di jaringan uji).
  - Gas on-chain devnet (fee, rent, Raydium creation fee) dibayar dari saldo SOL devnet milik wallet user sendiri — faucet SOL devnet sudah mencukupi; treasury devnet tidak butuh airdrop.
- **Penandaan & isolasi data**: setiap row `orders`/`tokens`/`pools`/`wallet_events` membawa `wallet_id` + `kind` (`mainnet`|`demo`). Token/pool demo **disembunyikan** dari explore, sitemap, dan statistik publik — tetap bisa dibuka via link milik pemiliknya (badge DEMO + link explorer `?cluster=devnet`).

### F-K. Burn Token & Burn & Earn + Menu Fitur Dashboard
Tujuan: user dapat **mengurangi supply** token miliknya secara on-chain, sekaligus insentif (reward point) — semua dari dalam aplikasi.
- **Menu fitur di dashboard**: 6 kartu — **Token Creator** (`/create`), **Create Liquidity** (`/dashboard/tokens`), **Swap Token** (`/dashboard/wallet`), **Remove Liquidity** (`/dashboard/tokens`), **Burn Token** (`/dashboard/burn?mode=burn`), **Burn & Earn** (`/dashboard/burn?mode=earn`).
- **Burn Token**: bakar token yang dipegang wallet aktif (SPL Token **&** Token-2022 — program dideteksi otomatis). `burnChecked` + `closeAccount` saat saldo habis (rent ATA dikembalikan ke user). Dekrementasi `tokens.total_supply` bila membakar token milik sendiri. Idempoten via `burn_events` (`order_id` unik). **Mainnet saja** (demo → 403).
- **Burn & Earn**: burn yang sama, gratis (0 USDC), user mendapat **1 reward point per token utuh** yang dibakar (`floor(amount)`), tercatat di `burn_events` + panel reward di halaman burn.
- Gas transaksi = **dari saldo SOL user** (fee-payer = wallet user), konsisten dengan model §6.3.

---

### F-L. Algo Marketplace (Feed Sinyal Berlangganan)
Tujuan: siapa pun dapat **menerbitkan algo** (sinyal via webhook) — gratis atau berbayar USDC — dan member lain dapat **berlangganan**; feed publik terlihat semua orang, subscriber aktif dapat **slot output** (forward otomatis ke Discord/dll).

- **Creator** (`/dashboard/algos`): buat algo (nama, deskripsi, harga USDC 0 = free, billing *lifetime* sekali bayar atau *monthly* 30 hari — renewal = bayar lagi, komisi terpotong tiap pembayaran). Tiap algo dapat maks **5 token input webhook** (`POST /api/algos/[id]/hook/[token]`, JSON fleksibel, rate limit 120/menit/token, payload maks 32 KB). Creator bisa pause/resume algo, revoke hook, hapus message dari feed.
- **Feed publik** (`/algos` directory + `/algos/[id]`): message tampil untuk **semua orang tanpa login** (termasuk algo berbayar — feed tidak pernah di-paywall); render aman (escape + ekstrak field teks, raw JSON bisa dibuka); live poll tiap 10 detik; paginasi `after=<id>`.
- **Subscribe**: free → instan tanpa transaksi; berbayar → **satu transaksi USDC mainnet** dari wallet subscriber: komisi platform (TETAP, default **1 USDC**, admin atur di panel pricing key `algo_commission`) → treasury, sisanya → creator; **gas dibayar subscriber** (model §6.3); preflight saldo 402; harga algo wajib **> komisi** (divalidasi saat create/patch/subscribe). Wallet utama = mainnet (demo ditolak). Subscription tercatat di `algo_subscriptions` (riwayat per pembayaran).
- **Slot output** (subscriber, maks 3 per algo): URL tujuan http(s) dengan guard SSRF (tolak localhost/IP privat/domain internal). Selama langganan aktif setiap message di-forward inline (timeout 8 detik) + **retry via job `algo_forward`** (backoff 30s×attempts); status terakhir per slot tampil di UI. Langganan expired → slot otomatis pause (feed tetap terlihat).
- **Admin**: commission flat USDC di panel pricing (`PATCH /api/admin/pricing` key `algo_commission`); audit `algo_created|algo_updated|algo_subscribed|algo_hook_*|algo_slot_*|algo_message_deleted`.
- **Mainnet saja** (konsisten USDC produksi).

---

### F-M. Event Tracker + Landing Feature Intro
Tujuan: admin memposting **link pengumuman/komunitas** (post X/Twitter atau URL apa pun + caption) yang tampil publik sebagai **kartu preview website**; beranda difokuskan sebagai halaman pengenalan dua fitur utama.

- **Event Tracker** (`/events`): admin POST URL + caption (guard SSRF, rate limit30/jam, audit `event_created|event_deleted`); meta card diambil server-side saat posting — URL X/Twitter via **oEmbed** (`publish.twitter.com`), URL lain via **og:title/og:description/og:image** (timeout4s, fallback kartu host); disimpan di kolom `meta jsonb`. Kartu: thumbnail + badge (Post on X / Link) + judul + deskripsi + host, membuka link di tab baru; admin dapat tombol Hapus (confirm). Publik hanya bisa melihat.
- **Landing** (`/`): hero framing industri finance ("One platform for modern finance — tokens, algos & futures") + stats + **2 blok fitur** — Token Launcher & Algo Marketplace (body + bullets + CTA `Create Token`/`Explore` dan `Browse algos`/`Publish your algo`); subtitle & ticker menonjolkan algo marketplace + **event/giveaway tracker di X** (bukan hanya token Solana); meta description ikut framing finance.
- **Navigasi utama (urut)**: `Algos | Create Token | Explore Token | Event Tracker`; footer menambah Algos & Events.

### F-P. Halaman FAQ
Tujuan: dokumentasi mandiri di dalam aplikasi — user paham cara kerja fitur, ekosistem, dan transaksi tanpa harus bertanya ke admin.

- **FAQ** (`/faq`): **7 seksi · 27 Q&A accordion** — *Getting started · Token launcher & markets · Wallets & transactions · How fees work · Algo marketplace (signals) · Event Tracker & community · Troubleshooting*; metadata SEO sendiri (`generateMetadata`); tautan di nav & footer; masuk `sitemap.xml`; URL tanpa prefix (`/faq` → `/en/faq`).

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

### 6.1 Komponen biaya nyata (on-chain; gas dari saldo SOL user, fee USDC masuk treasury)
| Komponen | Perkiraan biaya on-chain |
|---|---|
| Create token (mint + metadata + ATA + supply) | ≈ 0.010–0.020 SOL (rent 165-byte mint ≈ 0.0015 SOL, metadata ≈ 0.005–0.01 SOL, ATA ≈ 0.002 SOL, fee & priority kecil) |
| Buat pool liquidity (CPMM) | ≈ 0.2 SOL (rent pool + vault, sesuai catatan resmi Raydium) — diverifikasi ulang di spike Fase 4 terhadap Meteora/Orca |
| Tambah / kuras likuiditas | fee jaringan saja (≈ 0.00001–0.001 SOL dengan priority) |
| Swap (Jupiter) | fee jaringan + fee pool DEX |
| Transfer USDC (bayar layanan / withdrawal) | ≈ 0.000005 SOL |

> **Angka vs syarat saldo (17 Okt):** yang ditampilkan ke user = **estimasi riil** `GAS_ESTIMATE` (**0.02 SOL** token / **0.2 SOL** pool — dipakai wizard *Review & pay* & kartu fee di wallet); syarat saldo preflight `SOL_REQUIREMENT` = **0.025 / 0.28 SOL** (buffer tipis di atas biaya riil; gateway402 bila kurang).

### 6.2 Harga contoh ke user (dalam USDC)
| Layanan | Harga | Catatan |
|---|---|---|
| Create token | **2 USDC** | fee platform; gas on-chain (≈0.01–0.02 SOL) dari saldo SOL user — lihat §6.1 |
| Buat liquidity pool | **10 USDC** + dana LP (dari saldo user) | biaya rent pool besar → ditanggung penuh user |
| Tambah likuiditas | **1 USDC** | flat |
| Kuras likuiditas | **Gratis** | gas sudah tercakup margin |
| Swap in-app | **0.30%** dari nilai swap (min 0.05 USDC) | mencakup likuiditas route (gas swap dari SOL user) |
| Withdrawal USDC | **0.50 USDC** flat | di atas biaya jaringan |
| Burn Token | **0.25 USDC** flat | gas dari saldo SOL user |
| Burn & Earn | **Gratis** | insentif reward point (§F-K) |
| Topup | **Gratis** | |

Rumus dasar harga:
```
harga_user = (biaya_on_chain_USDC × (1 + buffer_gas)) + margin_platform
buffer_gas default 15% (fluktuasi harga SOL & priority fee)
```

### 6.3 Operasional treasury
- Treasury = hot wallet platform (terpisah dari wallet user): **penerima fee USDC** dan **sumber dana refund** — **bukan** fee-payer transaksi.
- Treasury **tidak menyimpan float SOL** — semua gas dibayar wallet user dari saldo SOL-nya sendiri (operator platform tidak perlu mendanai gas; $0 biaya gas platform).
- **Refund** ditandatangani treasury sebagai pengirim USDC, tetapi **gas refund dari saldo SOL wallet user**; job refund diretry lama (hingga 60×) agar user sempat mengisi SOL bila habis. Jika SOL user habis permanen, refund tertunda sampai user top-up (risiko langka, tercatat di §10).
- **Penarikan & pengisian treasury via admin panel (18 Okt)**: admin dashboard (tab Revenue) punya kontrol **deposit** (wallet aktif admin → treasury) & **withdraw** (treasury → wallet aktif admin) dalam **USDC atau SOL**. Tujuan/source di-hardcode server (hanya wallet aktif admin mainnet — anti drain ke alamat asing); pre-check saldo + buffer gas 0.01 SOL; nominal pakai `uiToRaw` (presisi string); cap 50.000 USDC / 1.000 SOL per transaksi; rate limit 5×/menit fail-closed; audit `treasury_deposit`/`treasury_withdraw`. Catatan: withdraw dari treasury butuh SOL di treasury untuk gas — deposit SOL dulu bila 0.

---

## 7. Requirements Non-Fungsional

### 7.1 Keamanan (kustodial = tanggung jawab paling berat)
| Kebutuhan | Implementasi wajib |
|---|---|
| Kerahasiaan private key | Enkripsi AES-256-GCM, master key hanya di secret environment (tidak pernah di repo/log) |
| Isolasi | Private key tidak pernah dikirim ke client, tidak muncul di API response, tidak di-log |
| Akses | Semua endpoint mutasi wajib session; RLS Supabase per user; role `admin` terpisah |
| Penarikan dana | Konfirmasi OTP email, validasi alamat, audit log, rate limit per user/IP |
| Anti-abuse | Rate limit (registrasi ≈3 user/jam via SMTP Supabase + notice di halaman register, order, cek saldo), idempotency key, validasi input ketat |
| Supply chain | Pin dependensi, `npm audit` saat CI, tanpa dependensi eksotis di jalur signing |
| Transparansi | Setiap aksi menyimpan `tx_signature` yang bisa diverifikasi publik |

### 7.2 Performa & Skala
- Halaman publik dirender dinamis (SSR) dengan cache market data 15 detik; ISR `revalidate` dinonaktifkan pada implementasi saat ini (kompatibel dengan mode render Next 16 yang dipakai).
- Snapshot harga tiap 1 menit + job siklis (index wallet) dijalankan Cloudflare Cron Trigger `artian-cron` (worker kecil, `cron-worker/`, ping `/api/cron/run-jobs` tiap menit) — cron ini sekaligus menjadi heartbeat DB (menyentuh DB tiap menit, §10 R5); GitHub Actions `worker.yml` hanya fallback manual (`workflow_dispatch`). Job `treasury_rebalance` dimatikan (treasury tidak butuh float gas). Endpoint yang sama juga menjalankan **purge log harian tiap 00:00 WITA** (16:00 UTC, window 5 menit + marker `pricing_config.jobs_purged_at` anti-dobel; `?purge=true` untuk paksa/uji): menghapus baris `jobs` **done/failed** (pending/running dibiarkan — panel job di admin dashboard jadi bersih) + `price_snapshots` **lebih tua dari 30 hari** (retensi = jendela chart tertua; alasan: log price-snapshot tiap menit membuat DB cepat penuh).
- RPC: Helius free (10 RPS) dengan fallback publik + exponential backoff.
- Semua pekerjaan berat (build tx, kirim, konfirmasi) berjalan **asinkron** lewat job queue — request user tidak pernah menunggu konfirmasi on-chain.

### 7.3 Internasionalisasi
- **Satu bahasa: English** (keputusan 17 Okt) — semua string via `messages/en.json`; `messages/id.json` sudah dihapus.
- **URL tanpa prefix locale**: `/en/*` & `/id/*` di-redirect permanen ke versi tanpa prefix, route `next.config.ts` me-rewrite ke segmen `[locale]` internal (multi-locale kembali tersedia cukup tambah katalog bahasa).
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
wallets             — id pk, user_id→profiles, kind(mainnet|demo), label,
                      public_key unique, enc_secret_key, iv, auth_tag,
                      archived_at timestamptz null (soft-delete; 0007)
                      (banyak wallet mainnet per user; partial unique 1 demo/user
                       NON-arsip: where kind='demo' and archived_at is null)
balances_cache      — wallet_id pk→wallets, user_id, usdc_raw, sol_lamports, refreshed_at
wallet_events       — user_id, wallet_id, kind(mainnet|demo),
                      type(deposit|payment|withdrawal|swap|refund|lp),
                      mint, amount_raw, signature, meta, confirmed_at
orders              — user_id, wallet_id, kind(mainnet|demo),
                      service(create_token|create_pool|add_liquidity|
                      remove_liquidity|withdraw|swap), amount_raw,
                      status(awaiting_payment|paid|processing|confirmed|failed|
                      refunded|cancelled), pricing, config, payment_signature,
                      idempotency_key, tx_signature, error
tokens              — user_id, wallet_id, kind(mainnet|demo), mint, order_id, name,
                      symbol, decimals, supply, logo_uri, metadata_uri, description,
                      socials, revoke_mint, revoke_freeze, immutable, status, created_tx
pools               — user_id, wallet_id, kind(mainnet|demo), token_id, dex(raydium_cpmm),
                      pool_id, quote_mint, fee_tier, initial_price, lp_percentage, lp_raw,
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
                      treasury_rebalance (dimatikan)|refund|algo_forward (retry feed→slot)),
                      status(pending|running|done|failed), attempts, run_at, last_error
algos               — id pk, user_id→profiles, name, description, price_usdc,
                      billing(lifetime|monthly), is_active, created_at, updated_at   (0008)
algo_hooks          — id pk, algo_id→algos, token unique, label, active,
                      last_used_at, created_at                                       (0008)
algo_messages       — id bigserial pk, algo_id→algos, hook_id→algo_hooks null,
                      payload jsonb, text, created_at                                (0008)
algo_subscriptions  — id pk, algo_id, user_id, status(active|expired|canceled),
                      billing, price_raw, commission_raw, tx_signature,
                      starts_at, expires_at (null = lifetime), created_at             (0008)
algo_slots          — id pk, algo_id, user_id, dest_url, active, last_status,
                      last_delivered_at, created_at                                  (0008)
events              — id pk, url, caption, meta jsonb (oEmbed/og preview),
                      created_by→profiles, created_at                                (0009)
```

---

## 9. Asumsi & Open Questions

| # | Asumsi / Pertanyaan | Status |
|---|---|---|
| A1 | "Persen di liquidity pool vs dilengkap ke market" = X% supply masuk pool, (100−X)% menjadi circulating/market di wallet creator | Asumsi disepakati; bisa diubah jadi "sisa di-hold platform" bila diperlukan |
| A2 | Nama brand sementara **Artian Capital Group** | Placeholder, mudah diganti |
| A3 | Pair default pool = TOKEN/USDC | Disepakati; TOKEN/SOL jadi opsi |
| A4 | Withdrawal **hanya USDC** (SOL/token wajib swap dulu) | Disepakati |
| A5 | **User-paid gas**: wallet user = fee-payer semua transaksi (saldo SOL user); fee layanan (USDC) masuk treasury — platform tidak mendanai gas | Disepakati (menggantikan "gas ditanggung treasury") |
| Q1 | Perlu export private key di kemudian hari? | Ditunda — fase lanjut, dengan KYC/keamanan tambahan |
| Q2 | Perlu fiat on-ramp (mis. QRIS) untuk user tanpa USDC? | Fase lanjut, setelah tinjauan ToS gateway & risiko regulasi |

---

## 10. Risiko & Mitigasi

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Kebocoran master key / hot wallet | Kehilangan dana user | Enkripsi ketat, secret hanya di env, pisahkan treasury & key user, audit log, monitoring saldo, siapkan prosedur rotasi & pemindahan dana |
| R2 | Saldo SOL user habis saat gas dibutuhkan (termasuk untuk refund) | Order ditolak preflight (402) atau refund tertunda | Preflight `requiredSolFor()` sebelum order dibuat + pesan jelas di UI; refund diretry lama (60×); panduan deposit SOL di halaman Wallet |
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
- `README.md` — status terkini per batch, setup lokal, perintah, environment, CI/CD, biaya.
- `SECRETS.md` — inventaris kredensial & API key (**gitignored, jangan commit/push**).

---

## 13. Status Implementasi & Deviasi (17–18 Oktober 2026)

Kode seluruh fase (F0–F6 + F-J + F-K burn) diimplementasikan; `lint + typecheck + test (43 kasus) + build` hijau; CI (`ci.yml`) & worker cron (`worker.yml`) aktif. Database Supabase `vysgkjqbmgbbowsxafok` live dengan migrasi **0001–0010** (`0005_rate_limit`, `0006_burn`, `0007_wallet_archive`, `0008_algo`, `0009_events`, `0010_webhooks` — 0008–0010 dijalankan manual via SQL Editor karena `db push` mentok history remote timestamped) lewat MCP `apply_migration`; RLS advisors bersih. **LIVE di produksi:** <https://artian-capital-group.trading-ekaryan.workers.dev> (Cloudflare Workers, `npm run deploy:cf`, secrets runtime terpasang termasuk `JUPITER_API_KEY` Server key & PostHog aktif). Smoke on-chain devnet lulus dari site live (create token **SMOKE** + pool Raydium CPMM aktif). **Go-live prep (17 Okt 2026):** e2e smoke 45 cek lulus (public pages, auth, preflight 400/402 semua layanan, admin RBAC, cron) → **reset total database** (semua data user/order/token/pool/jobs/storage dihapus, `pricing_config` 9 baris dipertahankan, akun admin perlu dibuat ulang). **Go-live batch 17 Okt (lanjutan):** production **di-switch ke `mainnet-beta`** (wallet demo tetap devnet; admin dashboard hanya data mainnet; explore menampilkan token devnet dengan label **Devnet**); wizard *Review & pay* kini **itemisasi biaya + gas lengkap** (fee USDC per layanan, estimasi SOL, total kini/menyusul, cek saldo USDC & SOL) + **stepper liquidity ±1 USDC** (default 50, min 0) + slider **LP% default 90/10** — **pool awal dibuat otomatis** oleh runner setelah token confirmed (fee pool 10 USDC + gas di-charge saat itu, idempotency `pool-<orderId>`, gagal → token tetap hidup + CTA manual); cron GitHub Actions (jadwal tidak andal) diganti **Cloudflare Cron Trigger `artian-cron`** (`* * * * *`, terverifikasi per-menit; `worker.yml` tinggal `workflow_dispatch` fallback). Sisa: spike pembanding DEX (F4), rate limit signup Supabase SMTP (≈3/jam, notice di halaman register), rotate kredensial yang pernah lewat chat. **Batch F-L algo marketplace (18 Okt 2026):** migrasi **0008** (5 tabel `algo_*` + `jobs.type` `algo_forward`), 9 route API (`/api/algos*`), halaman `/algos`, `/algos/[id]`, `/dashboard/algos`, nav Algos, commission flat admin (`algo_commission`, fallback 1 USDC); rewrite `next.config.ts` `/algos*` → `/en/algos*`; **E2E live `scripts/e2e-algo-test.py` 50/50 lulus** + regresi admin 12/12; gates `lint+typecheck+28 test+build` hijau; deploy live `d0f5ed04`. **Batch F-M (18 Okt 2026):** migrasi **0009** (`events`), API `/api/events*` (admin posting + meta oEmbed/og server-side), halaman `/events`, landing baru (hero + 2 blok fitur), nav urut **Algos | Create Token | Explore Token | Event Tracker**, footer + rewrite `/events*`; smoke **19/19** + regresi 12/12 &50/50; deploy `f4f41a06`. **Batch F-N — operasi admin + purge log (18 Okt 2026):** `POST/DELETE /api/admin/users/[userId]/wallet` (topup/withdraw dompet user mainnet ↔ wallet aktif admin, gas dibayar admin, cap+rate-limit fail-closed+audit; hapus dompet permanen dengan guard saldo on-chain hampir nol — sisanya arahkan withdraw dulu), `DELETE /api/algos/[id]` admin-only (cascade algo_*), detail `/api/admin/users?id=` kini menyertakan `algos`, UI panel Users: form topup/withdraw + tombol hapus dompet & hapus algo (konfirmasi), **purge harian00:00 WITA** di `/api/cron/run-jobs` (jobs done/failed + price_snapshots >30 hari, `src/lib/jobs/purge.ts`, marker anti-dobel, `?purge=true` untuk uji); E2E admin **26/26**; gates `lint+typecheck+28 test+build` hijau. **Batch F-O — webhook alert5 slot (18 Okt 2026):** `GET/PATCH /api/admin/webhooks` (URL per slot di `pricing_config` `webhook_events|tx|wallet|algo|user`, value `{url}`, validasi SSRF `assertSafeDestUrl`, "" = bersihkan), pengiriman lewat job `webhook_alert` (retry30s×3, timeout8s, redirect ditolak; envelope `{event, slot, text, content, url, ts, data, username, avatar_url, embeds}` — **`content` sengaja kosong sehingga Discord hanya merender `embeds`** (tanpa kalimat dobel), embed = judul klik-able ke `url` (events → URL post eksternal; slot lain → `/admin` · `/admin/revenue` · `/admin/users` · `/algos/[id]`), deskripsi **hanya caption event** (potong 280 char), **maks 3 field penting** (amount+asset digabung, base58 diringkas `5cG1oj5…3Fg361`, UUID 8 char; `User Id`/`Kind`/`subkind`/`actor` dibuang, label dompet default = turunan `kind` ikut dibuang), warna per slot + timestamp + `username`/`avatar_url` `/icon.png`, tanpa footer — `buildWebhookEnvelope()` di `src/lib/webhooks.ts`; receiver generik tetap membaca `text` (ringkasan + URL) & `url` top-level), trigger: post event baru (slot events), order dibayar / WD confirmed / langganan algo paid / treasury / topup-withdraw admin (slot tx), wallet baru mainnet+demo di `insertWallet` (slot wallet), algo baru (slot algo), **user baru via job siklis `user_alert_scan`** (registrasi lewat GoTrue langsung — bandingkan `created_at` vs marker `webhook_user_scan_state`; scan pertama tanpa spam), UI kartu Webhooks di halaman Admin; migrasi **0010** (tambah2 tipe job); E2E admin **46/46** (delivery live ke postman-echo + 5 cek set/clear discord; migrasi0010 terverifikasi via probe REST). **Tombol Discord popup (18 Okt):** tombol bulat blurple fixed kanan-bawah di SEMUA halaman (`DiscordButton`) → popup kartu "Join our Discord" + CTA buka tab baru; URL invite diset admin di kartu Webhooks (slot `discord`, key `discord_invite_url`), dibaca via endpoint publik `GET /api/discord` (cache60s, rate limit per-IP) — URL kosong → tombol tidak dirender. **Batch F-P — halaman FAQ (18 Okt 2026):** `src/app/[locale]/faq/page.tsx` — **7 seksi, 27 Q&A accordion** (*Getting started · Token launcher & markets · Wallets & transactions · How fees work · Algo marketplace (signals) · Event Tracker & community · Troubleshooting*) + `generateMetadata` sendiri; tautan `nav` (`src/components/nav.tsx`) & `footer`; masuk `sitemap.xml` (priority 0.7); rewrite `/faq` → `/en/faq` ditambahkan ke `next.config.ts` (prefixless). **Hardening (17–18 Okt 2026):** rate limit **berbasis DB** `0005_rate_limit` (tabel `rate_limit_events` + RPC `rate_limit_take`, atomic & lintas isolate, gagal → fail-closed kecuali `failOpen`), **security headers + CSP** di `next.config.ts` (`X-Frame-Options: DENY`, `X-Content-Type-Options`, HSTS 2 tahun, `Referrer-Policy`, `Permissions-Policy`, CSP `connect-src` hanya Supabase/PostHog/Helius/RPC Solana), serta perbaikan **13 temuan audit** (C1–C4, H1–H6, M2, M4, M5, M7, L5) dan **19 temuan audit** (idempotensi, fee withdraw, presisi FK, loop). **Fix DELETE idempoten (18 Okt 2026):** respons **404 JSON** dari `DELETE` dianggap **sukses** di **9 aksi hapus UI** (6 komponen: `algo-view`/feed sinyal, `algo-manager` hook & slot, `comments`, `delete-event-button`, `wallet-switcher`, `users-panel` wallet & algo) — sebelumnya memunculkan error 404 palsu bila row sudah terhapus.

| Area (referensi §) | Status | Catatan deviasi / gap |
|---|---|---|
| F-A: register + OTP + login + sesi | ✅ Selesai | — |
| F-A: wallet otomatis 1:1 dengan akun | ✅ Selesai | Dibuat via `ensureProfile`/`ensureWallet` di aplikasi (bukan trigger DB `handle_new_user`) |
| F-A: lupa password | ❌ Dihapus (keputusan) | Tanpa Resend — reset password di luar scope fase 1 |
| F-B: topup & saldo otomatis | ✅ Selesai | Baca saldo on-chain + konfirmasi tx → `wallet_events`; **QR deposit belum ada**; scan riwayat penuh membutuh Helius (tanpa itu keterbatasan RPC publik) |
| F-C: create token end-to-end | ✅ Selesai | Payer & mint/freeze authority = wallet user sejak awal (revoke opsional), immutable opsional, metadata di Storage |
| F-D: halaman profil token | ✅ Selesai | `generateMetadata` + OG, chart, statistik, panel pool, komentar, watchlist |
| F-D/§7.4: JSON-LD, `sitemap.xml`, `robots.txt` | ✅ Selesai | `robots.txt` (blok `/api/`, admin, verify), `sitemap.xml` (static English-only + token live dari DB + **`/faq`** priority 0.7), JSON-LD `WebSite`+`SearchAction` di layout & `WebPage`+`Offer` di halaman token, favicon `src/app/icon.png` |
| F-E: liquidity pool (Raydium CPMM) | ⚠️ Sebagian | Pair **USDC** berfungsi; **SOL sebagai quote belum tersedia di UI** (backend generik). Fee tier di UI masih default 0.25% (API menerima 1–100 bps). Spike pembanding Meteora/Orca (exit F4) tertunda |
| F-F: swap in-app (Jupiter) | ✅ Selesai | Fee 0.30% (min 0.05) dipotong dari hasil swap saat job |
| F-G: withdrawal USDC + OTP + audit | ✅ Selesai | OTP email butuh `RESEND_API_KEY` (dibatalkan) → kode tampil langsung di UI (**devCode**, mode MVP); batas harian/whitelist = fase lanjut |
| F-H: explore, watchlist, komentar, statistik | ✅ Selesai | **Profil publik user** (per-user halaman) belum ada |
| F-I: admin panel | ⚠️ Sebagian | Overview, pricing, daftar order, jobs, treasury ✅; **manual retry/refund, moderasi komentar, suspend, viewer audit log belum ada di UI** |
| F-J: mode demo (devnet) & multi-wallet | ✅ Selesai | Multi-wallet mainnet + maks 1 wallet demo/user; create token & liquidity pool di devnet dibayar USDC devnet; deposit demo manual via faucet eksternal; WD/swap dinonaktifkan di mode demo; token/pool demo difilter dari explore/sitemap |
| F-K: burn + Burn&Earn + menu dashboard | ✅ Selesai | Migrasi 0006 (`burn_events` + pricing `burn` 0.25 USDC / `burn_earn` gratis); mainnet saja; **izin buy/sell (transfer hook) dibatalkan** oleh user — Raydium CPMM menolak TransferHook (error 6007) |
| F-L: algo marketplace (feed sinyal + langganan) | ✅ Selesai | Migrasi 0008 (5 tabel `algo_*` + job type `algo_forward`); commission flat default 1 USDC via `pricing_config.algo_commission`; feed publik tanpa login; free = subscribe instan; paid = 1 tx split creator+treasury (gas subscriber); SSRF guard + retry job; **tanpa retention/pagination khusus selain `after`**; moderation = hapus message oleh creator/admin |
| F-M: event tracker + landing intro | ✅ Selesai | Migrasi 0009 (`events` + `meta jsonb`); preview server-side (oEmbed X / og-tags, fallback host); admin-only tulis/hapus; landing difokuskan 2 fitur (Create Token + Algo); nav urut Algos · Create Token · Explore Token · Event Tracker; rewrite `/events*` |
| F-P: halaman FAQ (18 Okt) | ✅ Selesai | 7 seksi · 27 Q&A accordion di `/faq` + metadata SEO sendiri; nav & footer; sitemap; rewrite `/faq` → `/en/faq` |
| F-N: operasi admin atas dompet/algo user + purge log | ✅ Selesai | topup/withdraw dompet user (gas dibayar admin, cap+rate limit+audit), hapus dompet (guard saldo ≈0), hapus algo (cascade), purge `jobs`+`price_snapshots` >30 hari tiap 00:00 WITA |
| F-O: webhook alert 5 slot + tombol Discord | ✅ Selesai | Migrasi 0010; URL per slot di `pricing_config` + anti-SSRF; job `webhook_alert` (retry3×); deteksi user baru siklis; tombol Discord baca `GET /api/discord` |
| └ payload alert (18 Okt — penyempurnaan) | ✅ Selesai | `buildWebhookEnvelope()`: URL top-level `url` + **styling Discord** (`embeds`, `username`, `avatar_url` `/icon.png`, warna per slot, timestamp); receiver generik tetap `text` |
| └ penyederhanaan pesan (18 Okt malam) | ✅ Selesai | `content` dikosongkan → Discord tampil **embed saja** (hilangkan kalimat dobel); field disaring **maks 3** (amount+asset digabung, base58 `5cG1oj5…3Fg361`, UUID 8 char); **dibuang**: `User Id`, `Kind`, `subkind`, `actor`, footer, label dompet default; deskripsi embed **hanya caption event** (280 char) |
| └ uji live 5 slot (18 Okt malam) | ✅ Lulus | Slot diarahkan sementara ke penangkap (webhook.site), lalu dipicu jalur **asli**: `events` = `POST /api/events` (admin), `wallet` = `POST /api/wallet` (user, label kustom), `user` = job siklis `user_alert_scan`; `algo` + **5 sub-jenis `tx`** = job `webhook_alert` berpayload persis seperti pemanggil (jalur berbayar tidak dipicu agar tak memakai dana). **9 payload terverifikasi**: `content` kosong, judul link, field ≤3, hash diringkas. **2 temuan diperbaiki**: (a) mapping key salah — payload asli memakai `amountRaw`/`priceRaw`/`service`/`tx` (bukan `amount`/`sig`) sehingga nominal sempat tidak tampil; (b) **alert `user` terkirim 3×** — marker scan disimpan *tanpa dicek* setelah mengumumkan → kini disimpan & **diverifikasi sebelum** mengumumkan, gagal → `throw` (job retry). URL asli 5 slot + marker dikembalikan, data uji dihapus |
| └ revisi format + slot `token` (18 Okt malam) | ✅ Selesai | Format **ringkas total** sesuai permintaan admin: embed **tanpa field, tanpa timestamp, tanpa footer**. `events` = *website card* (provider = domain post + judul link + deskripsi = caption 280 char, tidak ada lain-lain); `wallet` = `New wallet — mainnet/devnet` + alamat lengkap; `user` = `New user — @username` (fallback email); `algo` = *website card* `New algo — <nama>` judul link ke `/algos/[id]`; `tx` = `New Transaction — <jenis>` + signature + **tautan cek ke jaringan Solana** (`explorer.solana.com/tx/<sig>?cluster=…`, dompet demo otomatis `cluster=devnet`; `url` top-level juga menunjuk explorer). **Slot baru `token`** (key `webhook_token` — dibuat otomatis saat admin menyet URL pertama; kartu admin + label i18n `webhookToken`): dibidik di `handleTokenCreate` (job `create_token`) dengan data `mint/name/symbol/kind/tx` → judul `New token — <nama> (SIMBOL) · mainnet/devnet` + **2 tautan** (halaman token `/token/[mint]` & **mint di Solana Explorer**). Helper baru `explorerTxUrl()`/`explorerAddressUrl()` (`src/lib/webhooks.ts`); test **47 kasus**; cek E2E slot kini **6**; **diuji live 6/6 slot** (redirect sementara ke penangkap → 6 job payload asli → semua format terverifikasi; konfigurasi dipulihkan) |
| └ format teks tanpa embed + og-meta (18 Okt malam) | ✅ Selesai | **Embed dibuang total** (`embeds` selalu `[]`) — embed justru menghalangi Discord membuat kartu preview. `content` kini **teks biasa baris-per-baris dengan URL polos** (bukan `[label](url)`/`<url>`): `events` = judul + caption (280) + URL post; `wallet` = judul + alamat lengkap; `user` = `New user — @username`; `algo` = judul + URL halaman; `token` = judul + URL halaman token + URL mint explorer; `tx` = judul + `tx <signature>` + URL explorer → **Discord mendeteksi link sendiri dan membuat website card** dari og-meta halaman tujuan. `text` = `content` (receiver generik tetap dapat `url` top-level + `data`). **og-meta ditambahkan** agar kartu jelas: root layout (`siteName`/deskripsi/gambar `/icon.png`), `generateMetadata` baru di `/algos/[id]`, `openGraph` di `/token/[mint]` (gambar = **logo token**, fallback `/icon.png`); `username`/`avatar_url` tetap sbg nama pengirim. Test **46 kasus** |
| §7.3 i18n | ⚠️ Deviasi | **English-only + URL tanpa prefix** (keputusan 17 Okt) — bukan lagi 2 bahasa ber-prefix; `messages/id.json` dihapus, redirect `/en/*` & `/id/*` ke versi tanpa prefix |
| §7.1 keamanan (rate limit DB, headers/CSP, audit fix) | ✅ Selesai | Migrasi 0005 rate limit atomic lintas isolate; security headers + CSP `next.config.ts`; 13 temuan audit (C1–C4/H1–H6/M2/M4/M5/M7/L5) + 19 temuan (idempotensi, fee withdraw, presisi, FK, loop) diperbaiki |
| DELETE idempoten di UI (18 Okt) | ✅ Selesai | 404 JSON dianggap sukses di 9 aksi hapus (feed sinyal, hook, slot, komentar, event, wallet, algo) — hilangkan error 404 palsu |
| §7.2 ISR | ⚠️ Deviasi | Implementasi memakai SSR dinamis + cache market 15 detik (ISR tidak dipakai) |
| §5.1 state machine | ⚠️ Deviasi | Tidak ada status `draft`; ada `cancelled`; swap tanpa bayar di muka (lihat §5.1 yang diperbarui) |
| Exit criteria on-chain (F1/F2/F4/F5) | ⚠️ Sebagian | Smoke devnet F1/F2 lulus dari site live (16 Okt: token SMOKE + pool CPMM); spike pembanding DEX (F4) & F5 mainnet menyusul |
