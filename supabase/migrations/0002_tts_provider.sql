-- Adds the voice-engine choice ("webspeech" = free browser voice, "azure" =
-- premium Azure Cognitive Services Speech) to reader_settings. Run this in
-- the Supabase SQL editor after 0001_init.sql.

alter table public.reader_settings
  add column if not exists tts_provider text not null default 'webspeech';
