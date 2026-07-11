-- Colophon initial schema
-- Tables are scoped to auth.uid() via Row Level Security. Run this in the
-- Supabase SQL editor (or via `supabase db push`) on a fresh project.

-- ---------------------------------------------------------------------------
-- books
-- ---------------------------------------------------------------------------
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  author text,
  cover_path text,
  file_path text not null,
  toc jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists books_user_id_idx on public.books (user_id);

alter table public.books enable row level security;

create policy "books_select_own" on public.books
  for select using (auth.uid() = user_id);
create policy "books_insert_own" on public.books
  for insert with check (auth.uid() = user_id);
create policy "books_update_own" on public.books
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "books_delete_own" on public.books
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- reading_progress
-- ---------------------------------------------------------------------------
create table if not exists public.reading_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  spine_index integer not null default 0,
  sentence_index integer not null default 0,
  scroll_or_page_offset integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, book_id)
);

create index if not exists reading_progress_user_id_idx on public.reading_progress (user_id);
create index if not exists reading_progress_book_id_idx on public.reading_progress (book_id);

alter table public.reading_progress enable row level security;

create policy "reading_progress_select_own" on public.reading_progress
  for select using (auth.uid() = user_id);
create policy "reading_progress_insert_own" on public.reading_progress
  for insert with check (auth.uid() = user_id);
create policy "reading_progress_update_own" on public.reading_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reading_progress_delete_own" on public.reading_progress
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- highlights
-- ---------------------------------------------------------------------------
create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  spine_index integer not null,
  sentence_index_start integer not null,
  sentence_index_end integer not null,
  text_snippet text not null,
  color text not null default '#C9A227',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists highlights_user_id_idx on public.highlights (user_id);
create index if not exists highlights_book_id_idx on public.highlights (book_id);

alter table public.highlights enable row level security;

create policy "highlights_select_own" on public.highlights
  for select using (auth.uid() = user_id);
create policy "highlights_insert_own" on public.highlights
  for insert with check (auth.uid() = user_id);
create policy "highlights_update_own" on public.highlights
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "highlights_delete_own" on public.highlights
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- reader_settings
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.reader_theme as enum ('paper', 'sepia', 'dark');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.reader_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  font_family text not null default 'Literata',
  font_size integer not null default 18,
  line_spacing numeric not null default 1.6,
  theme public.reader_theme not null default 'paper',
  voice_name text,
  speech_rate numeric not null default 1.0,
  speech_pitch numeric not null default 1.0,
  speech_volume numeric not null default 1.0,
  updated_at timestamptz not null default now()
);

create index if not exists reader_settings_user_id_idx on public.reader_settings (user_id);

alter table public.reader_settings enable row level security;

create policy "reader_settings_select_own" on public.reader_settings
  for select using (auth.uid() = user_id);
create policy "reader_settings_insert_own" on public.reader_settings
  for insert with check (auth.uid() = user_id);
create policy "reader_settings_update_own" on public.reader_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reader_settings_delete_own" on public.reader_settings
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage: private bucket "library", one folder per user: {user_id}/{book_id}/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('library', 'library', false)
on conflict (id) do nothing;

create policy "library_select_own_folder" on storage.objects
  for select using (
    bucket_id = 'library' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "library_insert_own_folder" on storage.objects
  for insert with check (
    bucket_id = 'library' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "library_update_own_folder" on storage.objects
  for update using (
    bucket_id = 'library' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "library_delete_own_folder" on storage.objects
  for delete using (
    bucket_id = 'library' and auth.uid()::text = (storage.foldername(name))[1]
  );
