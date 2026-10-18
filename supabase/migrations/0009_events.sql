-- ============================================================
-- Migration 0009 — Event Tracker
-- ============================================================
-- Admin memposting URL (post X/Twitter atau URL apa pun) + caption.
-- Halaman publik /events menampilkannya sebagai kartu preview website
-- (meta og / oEmbed X diambil server-side, disimpan di meta jsonb).

create table public.events (
  id         uuid primary key default gen_random_uuid(),
  url        text not null check (char_length(url) between 10 and 2000),
  caption    text not null default '' check (char_length(caption) <= 500),
  meta       jsonb not null default '{}',
  created_by uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index events_created_idx on public.events (created_at desc);
alter table public.events enable row level security;
-- RLS tanpa policy: baca/tulis hanya via service-role (API server).
