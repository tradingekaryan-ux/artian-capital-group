-- ============================================================
-- 0004 — Audit fixes multi-wallet:
--   1. withdrawals.wallet_id — cek saldo & eksekusi job pakai wallet yang sama
--   2. Backfill wallet_events.wallet_id (event historis NULL → wallet
--      mainnet pemiliknya) agar "Aktivitas terakhir" per-wallet tampil
-- ============================================================

alter table public.withdrawals
  add column if not exists wallet_id uuid
  references public.wallets(id) on delete set null;

create index if not exists withdrawals_wallet_idx
  on public.withdrawals (wallet_id, created_at desc);

-- backfill: event lama (wallet_id NULL) dimiliki wallet mainnet pertama user
update public.wallet_events we
  set wallet_id = w.id
  from public.wallets w
  where w.user_id = we.user_id
    and w.kind = 'mainnet'
    and we.wallet_id is null;

-- event deposit demo/devnet yang tercatat tanpa wallet → sesuaikan kind-nya
update public.wallet_events we
  set kind = 'demo'
  from public.wallets w
  where w.id = we.wallet_id
    and w.kind = 'demo'
    and we.kind <> 'demo';
