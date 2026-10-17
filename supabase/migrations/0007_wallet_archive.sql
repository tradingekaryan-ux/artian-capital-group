-- 0007 — Archive wallet (soft-delete): wallets.archived_at
--        Baris terarsip: hilang dari daftar user & "aktif" (cookie diabaikan),
--        tetap terlihat di dashboard admin dengan label Archived.
--        Indeks unik demo diperbaiki: hanya wallet demo NON-arsip yang dihitung,
--        sehingga user bisa membuat demo baru setelah mengarsipkan yang lama.

alter table public.wallets add column if not exists archived_at timestamptz;

drop index if exists public.wallets_demo_one_per_user;
create unique index if not exists wallets_demo_one_per_user
  on public.wallets (user_id)
  where kind = 'demo' and archived_at is null;

create index if not exists wallets_archived_idx
  on public.wallets (user_id, archived_at);
