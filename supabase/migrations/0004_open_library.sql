-- Create open_library_books table
create table if not exists public.open_library_books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  cover_path text,
  file_path text not null,
  toc jsonb not null default '[]'::jsonb,
  uploader_email text,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.open_library_books enable row level security;

-- Policies for open_library_books
create policy "open_library_books_select" on public.open_library_books
  for select using (auth.role() = 'authenticated');

create policy "open_library_books_admin" on public.open_library_books
  for all using (
    auth.jwt() ->> 'email' = 'qumailaunali@gmail.com'
  ) with check (
    auth.jwt() ->> 'email' = 'qumailaunali@gmail.com'
  );

-- Modify books RLS select policy to allow admin to view all books
drop policy if exists "books_select_own" on public.books;
create policy "books_select_all_or_own" on public.books
  for select using (
    auth.uid() = user_id or auth.jwt() ->> 'email' = 'qumailaunali@gmail.com'
  );

-- Modify storage policies for the library bucket
-- Drop old select policy
drop policy if exists "library_select_own_folder" on storage.objects;
-- Create new select policy: own folder, open_library folder, or admin access
create policy "library_select_policy" on storage.objects
  for select using (
    bucket_id = 'library' and (
      auth.uid()::text = (storage.foldername(name))[1] or
      (storage.foldername(name))[1] = 'open_library' or
      auth.jwt() ->> 'email' = 'qumailaunali@gmail.com'
    )
  );

-- Create new insert policy for open_library folder
create policy "library_insert_open_library" on storage.objects
  for insert with check (
    bucket_id = 'library' and (
      (storage.foldername(name))[1] = 'open_library' and
      auth.jwt() ->> 'email' = 'qumailaunali@gmail.com'
    )
  );

-- Modify delete policy to allow users to delete own files, and admin to delete open library files
drop policy if exists "library_delete_own_folder" on storage.objects;
create policy "library_delete_policy" on storage.objects
  for delete using (
    bucket_id = 'library' and (
      auth.uid()::text = (storage.foldername(name))[1] or
      ((storage.foldername(name))[1] = 'open_library' and auth.jwt() ->> 'email' = 'qumailaunali@gmail.com')
    )
  );
