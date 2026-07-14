-- Creates the bookmarks table for storing user page bookmarks
-- in a book. Run this via `npm run db:migrate` or in Supabase SQL editor.

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  spine_index integer not null,
  sentence_index integer not null default 0,
  scroll_or_page_offset integer not null default 0,
  page_info text not null,
  created_at timestamptz not null default now()
);

create index if not exists bookmarks_user_id_idx on public.bookmarks (user_id);
create index if not exists bookmarks_book_id_idx on public.bookmarks (book_id);

alter table public.bookmarks enable row level security;

create policy "bookmarks_select_own" on public.bookmarks
  for select using (auth.uid() = user_id);

create policy "bookmarks_insert_own" on public.bookmarks
  for insert with check (auth.uid() = user_id);

create policy "bookmarks_delete_own" on public.bookmarks
  for delete using (auth.uid() = user_id);
