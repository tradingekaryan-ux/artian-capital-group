-- ============================================================
-- Artian Capital Group — initial schema
-- ============================================================

create extension if not exists "pgcrypto";

-- ── profiles (1:1 auth.users) ────────────────────────────────
create table public.profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  username       text unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name   text,
  bio            text,
  role           text not null default 'user' check (role in ('user','admin')),
  is_suspended   boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ── wallets (custodial, key terenkripsi) ─────────────────────
create table public.wallets (
  user_id         uuid primary key references public.profiles(user_id) on delete cascade,
  public_key      text not null unique,
  enc_secret_key  text not null,      -- AES-256-GCM (base64)
  iv              text not null,
  auth_tag        text not null,
  created_at      timestamptz not null default now()
);

-- ── balances_cache ───────────────────────────────────────────
create table public.balances_cache (
  user_id      uuid primary key references public.profiles(user_id) on delete cascade,
  usdc_raw     numeric not null default 0,   -- base unit (6 desimal USDC)
  sol_lamports bigint  not null default 0,
  refreshed_at timestamptz not null default now()
);

-- ── wallet_events (riwayat on-chain user) ────────────────────
create table public.wallet_events (
  id           bigserial primary key,
  user_id      uuid not null references public.profiles(user_id) on delete cascade,
  type         text not null check (type in ('deposit','payment','withdrawal','swap','refund','lp')),
  mint         text,
  amount_raw   numeric not null,
  signature    text,
  meta         jsonb not null default '{}',
  confirmed_at timestamptz not null default now(),
  unique (user_id, signature, type, mint)
);
create index wallet_events_user_idx on public.wallet_events (user_id, confirmed_at desc);

-- ── orders ───────────────────────────────────────────────────
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(user_id) on delete cascade,
  service            text not null check (service in ('create_token','create_pool','add_liquidity','remove_liquidity','withdraw','swap')),
  amount_raw         bigint not null,          -- biaya dalam USDC base unit
  status             text not null default 'awaiting_payment'
                     check (status in ('awaiting_payment','paid','processing','confirmed','failed','refunded','cancelled')),
  pricing            jsonb not null default '{}',
  config             jsonb not null default '{}',
  payment_signature  text unique,
  tx_signature       text,
  error              text,
  idempotency_key    text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_status_idx on public.orders (status);

-- ── tokens ───────────────────────────────────────────────────
create table public.tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(user_id) on delete cascade,
  mint          text not null unique,
  order_id      uuid references public.orders(id),
  name          text not null,
  symbol        text not null,
  decimals      int not null default 9 check (decimals between 0 and 9),
  supply        numeric not null check (supply > 0),
  logo_uri      text,
  metadata_uri  text,
  description   text,
  socials       jsonb not null default '{}',
  revoke_mint   boolean not null default true,
  revoke_freeze boolean not null default true,
  immutable     boolean not null default false,
  status        text not null default 'pending' check (status in ('pending','live','failed')),
  created_tx    text,
  created_at    timestamptz not null default now()
);
create index tokens_user_idx on public.tokens (user_id, created_at desc);
create index tokens_created_idx on public.tokens (created_at desc);

-- ── pools ────────────────────────────────────────────────────
create table public.pools (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  token_id        uuid not null references public.tokens(id) on delete cascade,
  dex             text not null default 'raydium_cpmm',
  pool_id         text unique,
  quote_mint      text not null,
  fee_tier        numeric not null default 0.25,
  initial_price   numeric,
  lp_percentage   numeric not null check (lp_percentage > 0 and lp_percentage <= 100),
  lp_raw          numeric,
  token_amount    numeric,
  quote_amount    numeric,
  status          text not null default 'pending' check (status in ('pending','active','failed')),
  created_tx      text,
  created_at      timestamptz not null default now()
);
create index pools_token_idx on public.pools (token_id);

-- ── pool_positions ───────────────────────────────────────────
create table public.pool_positions (
  id                bigserial primary key,
  user_id           uuid not null references public.profiles(user_id) on delete cascade,
  pool_id           uuid not null references public.pools(id) on delete cascade,
  lp_raw            numeric not null default 0,
  deposited_token   numeric not null default 0,
  deposited_quote   numeric not null default 0,
  updated_at        timestamptz not null default now(),
  unique (user_id, pool_id)
);

-- ── price_snapshots ──────────────────────────────────────────
create table public.price_snapshots (
  mint           text not null,
  ts             timestamptz not null,
  price_usd      numeric,
  liquidity_usd  numeric,
  volume_24h_usd numeric,
  fdv_usd        numeric,
  primary key (mint, ts)
);
create index price_snapshots_mint_ts_idx on public.price_snapshots (mint, ts desc);

-- ── watchlists ───────────────────────────────────────────────
create table public.watchlists (
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  mint       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, mint)
);

-- ── comments ─────────────────────────────────────────────────
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  mint       text not null,
  body       text not null check (char_length(body) between 1 and 1000),
  status     text not null default 'active' check (status in ('active','hidden')),
  created_at timestamptz not null default now()
);
create index comments_mint_idx on public.comments (mint, created_at desc);

-- ── withdrawals ──────────────────────────────────────────────
create table public.withdrawals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(user_id) on delete cascade,
  amount_raw     bigint not null check (amount_raw > 0),
  destination    text not null,
  status         text not null default 'pending'
                 check (status in ('pending','processing','confirmed','failed')),
  otp_hash       text,
  otp_expires_at timestamptz,
  tx_signature   text,
  error          text,
  created_at     timestamptz not null default now()
);
create index withdrawals_user_idx on public.withdrawals (user_id, created_at desc);

-- ── audit_logs ───────────────────────────────────────────────
create table public.audit_logs (
  id         bigserial primary key,
  actor      text,
  action     text not null,
  target     text,
  payload    jsonb not null default '{}',
  ip         text,
  created_at timestamptz not null default now()
);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- ── pricing_config ───────────────────────────────────────────
create table public.pricing_config (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- ── jobs (queue untuk worker GitHub Actions / cron) ──────────
create table public.jobs (
  id          bigserial primary key,
  type        text not null check (type in (
                'create_token','create_pool','add_liquidity','remove_liquidity',
                'withdraw','swap','index_wallet','price_snapshot','treasury_rebalance','refund')),
  payload     jsonb not null default '{}',
  status      text not null default 'pending'
              check (status in ('pending','running','done','failed')),
  attempts    int not null default 0,
  run_at      timestamptz not null default now(),
  last_error  text,
  created_at  timestamptz not null default now()
);
create index jobs_pending_idx on public.jobs (status, run_at);

-- ── seq for price snapshot bucket ────────────────────────────
-- (opsional: sequence untuk partitioning ringan, tidak dipakai di MVP)

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.wallets         enable row level security;
alter table public.balances_cache  enable row level security;
alter table public.wallet_events   enable row level security;
alter table public.orders          enable row level security;
alter table public.tokens          enable row level security;
alter table public.pools           enable row level security;
alter table public.pool_positions  enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.watchlists      enable row level security;
alter table public.comments        enable row level security;
alter table public.withdrawals     enable row level security;
alter table public.audit_logs      enable row level security;
alter table public.pricing_config  enable row level security;
alter table public.jobs            enable row level security;

-- profiles: publik bisa baca (tampil di halaman token), user tulis/baca diri sendiri
create policy "profiles readable" on public.profiles for select using (true);
create policy "profiles self insert" on public.profiles for insert
  with check (auth.uid() = user_id);
create policy "profiles self update" on public.profiles for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- wallets: TIDAK bisa dibaca client (service role only) — mencegah kebocoran
-- balances & events: user sendiri
create policy "balances self read" on public.balances_cache for select using (auth.uid() = user_id);
create policy "events self read" on public.wallet_events for select using (auth.uid() = user_id);

-- orders / withdrawals: user sendiri
create policy "orders self read" on public.orders for select using (auth.uid() = user_id);
create policy "withdrawals self read" on public.withdrawals for select using (auth.uid() = user_id);

-- tokens: publik baca, user write miliknya
create policy "tokens public read" on public.tokens for select using (true);
create policy "tokens self write" on public.tokens for insert with check (auth.uid() = user_id);
create policy "tokens self update" on public.tokens for update using (auth.uid() = user_id);

-- pools & positions
create policy "pools public read" on public.pools for select using (true);
create policy "pools self write" on public.pools for insert with check (auth.uid() = user_id);
create policy "positions self read" on public.pool_positions for select using (auth.uid() = user_id);

-- market & komunitas
create policy "snapshots public read" on public.price_snapshots for select using (true);
create policy "watchlist self" on public.watchlists for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "comments public read" on public.comments for select using (status = 'active');
create policy "comments self write" on public.comments for insert with check (auth.uid() = user_id);
create policy "comments self delete" on public.comments for delete using (auth.uid() = user_id);

-- pricing: publik baca (transparansi harga)
create policy "pricing public read" on public.pricing_config for select using (true);

-- admin-only (dicek lagi di server via service role; policy ini lapis pengaman)
create policy "audit admin read" on public.audit_logs for select using (
  exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
);

-- jobs & wallets & audit write: service role only (tanpa policy = anon ditolak)

-- ============================================================
-- ============================================================
-- Storage bucket untuk logo + metadata token (publik, 5MB)
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'token-assets',
  'token-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'application/json']
)
on conflict (id) do nothing;

-- siapa pun boleh baca (publik); hanya service role (server) yang menulis
create policy "token-assets public read"
  on storage.objects for select
  using (bucket_id = 'token-assets');

-- ============================================================
-- Default pricing (semua nilai dalam USDC, raw base unit 6 desimal)
insert into public.pricing_config (key, value) values
  ('create_token',  '{"amount_usdc": 2,  "label": "Create token"}'),
  ('create_pool',   '{"amount_usdc": 10, "label": "Create liquidity pool"}'),
  ('add_liquidity', '{"amount_usdc": 1,  "label": "Add liquidity"}'),
  ('remove_liquidity', '{"amount_usdc": 0, "label": "Remove liquidity"}'),
  ('swap',          '{"percent": 0.30, "min_usdc": 0.05, "label": "In-app swap"}'),
  ('withdraw',      '{"flat_usdc": 0.5, "min_usdc": 1, "max_daily_usdc": 50000, "label": "USDC withdrawal"}'),
  ('treasury',      '{"gas_sol_warn": 0.3, "gas_sol_target": 1.0, "label": "Treasury gas"}')
on conflict (key) do nothing;
