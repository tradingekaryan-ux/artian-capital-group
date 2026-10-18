-- ============================================================
-- Migration 0008 — Algo marketplace
-- ============================================================
-- Siapa pun bisa membuat algo (sinyal dari TradingView via webhook),
-- gratis atau berbayar USDC (sekali bayar lifetime / per-bulan).
-- Feed message publik terlihat semua orang (tanpa login).
-- Subscriber dengan langganan aktif boleh pasang slot output
-- (forward message ke URL eksternal, mis. Discord webhook).
-- Komisi platform: potongan TETAP (USDC) per pembayaran langganan,
-- diatur admin di pricing_config (key `algo_commission`).

-- ── algos (milik creator) ──────────────────────────────────
create table public.algos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(user_id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  description   text not null default '',
  price_usdc    numeric(18,6) not null default 0 check (price_usdc >= 0),
  billing       text not null default 'lifetime' check (billing in ('lifetime','monthly')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index algos_user_idx on public.algos (user_id, created_at desc);
create index algos_live_idx on public.algos (is_active, created_at desc);
alter table public.algos enable row level security;
-- RLS tanpa policy: akses hanya via service-role (API server).

-- ── algo_hooks (token input; TradingView → POST …/hook/[token]) ─
create table public.algo_hooks (
  id           uuid primary key default gen_random_uuid(),
  algo_id      uuid not null references public.algos(id) on delete cascade,
  token        text not null unique,
  label        text,
  active       boolean not null default true,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
create index algo_hooks_algo_idx on public.algo_hooks (algo_id);
alter table public.algo_hooks enable row level security;

-- ── algo_messages (feed publik) ────────────────────────────
create table public.algo_messages (
  id         bigint generated always as identity primary key,
  algo_id    uuid not null references public.algos(id) on delete cascade,
  hook_id    uuid references public.algo_hooks(id) on delete set null,
  payload    jsonb not null,
  text       text not null default '',
  created_at timestamptz not null default now()
);
create index algo_messages_algo_idx on public.algo_messages (algo_id, id desc);
alter table public.algo_messages enable row level security;

-- ── algo_subscriptions ─────────────────────────────────────
-- Renewal = row BARU (riwayat pembayaran tetap utuh; komisi terpotong
-- setiap pembayaran). Validitas = row terbaru per (algo,user).
create table public.algo_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  algo_id        uuid not null references public.algos(id) on delete cascade,
  user_id        uuid not null references public.profiles(user_id) on delete cascade,
  status         text not null default 'active' check (status in ('active','expired','canceled')),
  billing        text not null check (billing in ('lifetime','monthly')),
  price_raw      text not null default '0',
  commission_raw text not null default '0',
  tx_signature   text,
  starts_at      timestamptz not null default now(),
  expires_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index algo_subs_algo_idx on public.algo_subscriptions (algo_id, user_id, created_at desc);
create index algo_subs_user_idx on public.algo_subscriptions (user_id, created_at desc);
alter table public.algo_subscriptions enable row level security;

-- ── algo_slots (output forward; milik subscriber) ──────────
create table public.algo_slots (
  id                uuid primary key default gen_random_uuid(),
  algo_id           uuid not null references public.algos(id) on delete cascade,
  user_id           uuid not null references public.profiles(user_id) on delete cascade,
  dest_url          text not null,
  active            boolean not null default true,
  last_status       text,
  last_delivered_at timestamptz,
  created_at        timestamptz not null default now()
);
create index algo_slots_user_idx on public.algo_slots (algo_id, user_id);
create index algo_slots_live_idx on public.algo_slots (algo_id) where active;
alter table public.algo_slots enable row level security;

-- ── jobs: tambah tipe retry algo_forward ───────────────────
alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('create_token','create_pool','add_liquidity','remove_liquidity',
                  'withdraw','swap','index_wallet','price_snapshot','treasury_rebalance','refund',
                  'algo_forward'));
