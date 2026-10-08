-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, holding app-level account info (name).
-- Rows are created by a trigger on auth.users and removed with the user via
-- ON DELETE CASCADE, so the app never inserts or deletes them directly.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own_or_admin" on public.profiles
  for select using (
    auth.uid() = id or auth.jwt() ->> 'email' = 'qumailaunali@gmail.com'
  );
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Users may only edit their name, not id/timestamps.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Keep updated_at current on edits.
create or replace function public.profiles_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.profiles_set_updated_at();

-- Create a profile whenever a new auth user signs up, copying the name the
-- signup form stored in user metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 100))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users who signed up before this migration.
insert into public.profiles (id, full_name, created_at)
select
  u.id,
  left(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), 100),
  u.created_at
from auth.users u
on conflict (id) do nothing;
