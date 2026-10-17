-- 0005_rate_limit.sql — rate limiter berbasis DB (shared lintas isolate Workers)
create table if not exists public.rate_limit_events (
  key text not null,
  bucket_start timestamptz not null,
  count integer not null default 1,
  expires_at timestamptz not null,
  primary key (key, bucket_start)
);

alter table public.rate_limit_events enable row level security;

create index if not exists rate_limit_events_expires_at_idx
  on public.rate_limit_events (expires_at);

create or replace function public.rate_limit_take(p_key text, p_window_ms bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  v_bucket := to_timestamp(
    floor(extract(epoch from now()) * 1000.0 / p_window_ms) * p_window_ms / 1000.0
  );
  insert into public.rate_limit_events as r (key, bucket_start, count, expires_at)
  values (p_key, v_bucket, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key, bucket_start)
  do update set count = r.count + 1
  returning count into v_count;

  if random() < 0.02 then
    delete from public.rate_limit_events where expires_at < now();
  end if;

  return v_count;
end;
$$;

revoke execute on function public.rate_limit_take(text, bigint) from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, bigint) to service_role;
