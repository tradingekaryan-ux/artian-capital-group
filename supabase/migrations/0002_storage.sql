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
