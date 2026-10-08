-- Heartbeat table pinged by .github/workflows/supabase-keep-alive.yml so the
-- free-tier project isn't paused for inactivity. Single row, upserted in place.
create table if not exists public.keep_alive (
  id int primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now()
);

-- RLS on with no policies: only the service role (used by the workflow) can touch it.
alter table public.keep_alive enable row level security;
