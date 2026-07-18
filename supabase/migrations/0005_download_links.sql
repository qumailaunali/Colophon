-- Add download_links column to open_library_books
alter table public.open_library_books
add column if not exists download_links jsonb not null default '[]'::jsonb;
