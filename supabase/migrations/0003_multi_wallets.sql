-- ============================================================
-- 0003 — Multi-wallet (banyak mainnet + maks 1 demo per user)
--        & mode demo (devnet) untuk create token + liquidity pool
-- ============================================================

-- ── wallets: id baru sebagai PK, kind & label, 1 demo per user ──
alter table public.wallets drop constraint if exists wallets_pkey;
alter table public.wallets add column if not exists id uuid;
alter table public.wallets alter column id set default gen_random_uuid();
update public.wallets set id = gen_random_uuid() where id is null;
alter table public.wallets alter column id set not null;
alter table public.wallets add primary key (id);
alter table public.wallets add column if not exists kind text not null default 'mainnet'
  check (kind in ('mainnet','demo'));
alter table public.wallets add column if not exists label text;
-- partial unique: maksimal SATU wallet demo per user; mainnet bebas banyak
create unique index if not exists wallets_demo_one_per_user
  on public.wallets (user_id) where kind = 'demo';
create index if not exists wallets_user_idx on public.wallets (user_id, created_at);

-- ── balances_cache: sekarang per wallet (PK wallet_id) ────────
alter table public.balances_cache drop constraint if exists balances_cache_pkey;
alter table public.balances_cache add column if not exists wallet_id uuid;
-- backfill: cache lama dimiliki wallet mainnet pertama user
update public.balances_cache bc
  set wallet_id = w.id
  from public.wallets w
  where w.user_id = bc.user_id and w.kind = 'mainnet' and bc.wallet_id is null;
delete from public.balances_cache where wallet_id is null;
alter table public.balances_cache alter column wallet_id set not null;
alter table public.balances_cache
  add constraint balances_cache_wallet_pk primary key (wallet_id);
create index if not exists balances_cache_user_idx on public.balances_cache (user_id);

-- ── wallet_events: wallet_id + kind ──────────────────────────
alter table public.wallet_events add column if not exists wallet_id uuid
  references public.wallets(id) on delete set null;
alter table public.wallet_events add column if not exists kind text not null default 'mainnet';
create index if not exists wallet_events_wallet_idx on public.wallet_events (wallet_id, confirmed_at desc);

-- ── orders / tokens / pools: wallet_id + kind ────────────────
alter table public.orders add column if not exists wallet_id uuid
  references public.wallets(id) on delete set null;
alter table public.orders add column if not exists kind text not null default 'mainnet'
  check (kind in ('mainnet','demo'));

alter table public.tokens add column if not exists wallet_id uuid
  references public.wallets(id) on delete set null;
alter table public.tokens add column if not exists kind text not null default 'mainnet'
  check (kind in ('mainnet','demo'));

alter table public.pools add column if not exists wallet_id uuid
  references public.wallets(id) on delete set null;
alter table public.pools add column if not exists kind text not null default 'mainnet'
  check (kind in ('mainnet','demo'));

-- backfill wallet_id historis → wallet mainnet pertama pemiliknya
update public.tokens t set wallet_id = w.id
  from public.wallets w
  where w.user_id = t.user_id and w.kind = 'mainnet' and t.wallet_id is null;
update public.pools p set wallet_id = t.wallet_id
  from public.tokens t
  where t.id = p.token_id and p.wallet_id is null;
update public.orders o set wallet_id = w.id
  from public.wallets w
  where w.user_id = o.user_id and w.kind = 'mainnet' and o.wallet_id is null;

create index if not exists tokens_kind_idx on public.tokens (kind);
create index if not exists orders_wallet_idx on public.orders (wallet_id, created_at desc);
