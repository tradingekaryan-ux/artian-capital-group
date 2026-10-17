-- 0006: fitur Burn Token & Burn & Earn
-- Burn = pemilik membakar token miliknya sendiri (spl-token BurnChecked),
-- gas dibayar wallet user (user-paid gas); fee layanan USDC → treasury.
-- Burn & Earn = burn yang sama, tetapi dicatat sebagai reward poin (burn_events).

-- ── orders: service 'burn' ──────────────────────────────────
alter table public.orders drop constraint orders_service_check;
alter table public.orders add constraint orders_service_check
  check (service in ('create_token','create_pool','add_liquidity','remove_liquidity',
                     'withdraw','swap','burn'));

-- ── jobs: type 'burn' ───────────────────────────────────────
alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('create_token','create_pool','add_liquidity','remove_liquidity',
                  'withdraw','swap','index_wallet','price_snapshot',
                  'treasury_rebalance','refund','burn'));

-- ── burn_events (ledger reward Burn & Earn) ─────────────────
create table public.burn_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(user_id) on delete cascade,
  wallet_id   uuid references public.wallets(id) on delete set null,
  order_id    uuid unique references public.orders(id) on delete set null,
  mint        text not null,
  mode        text not null default 'burn' check (mode in ('burn','burn_earn')),
  amount_raw  numeric not null check (amount_raw > 0),
  amount_ui   numeric not null check (amount_ui > 0),
  points      bigint not null default 0,
  tx          text,
  created_at  timestamptz not null default now()
);
create index burn_events_user_idx on public.burn_events (user_id, created_at desc);

alter table public.burn_events enable row level security;
create policy "burn events self read" on public.burn_events
  for select using (auth.uid() = user_id);
-- insert/update hanya via service role (server).

-- ── pricing burn & burn_earn ────────────────────────────────
insert into public.pricing_config (key, value) values
  ('burn',      '{"flat_usdc": 0.25, "label": "Burn token"}'),
  ('burn_earn', '{"flat_usdc": 0,    "label": "Burn & Earn (point reward)"}')
on conflict (key) do nothing;
