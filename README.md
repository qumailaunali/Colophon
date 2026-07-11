# Colophon

A personal, single-user EPUB reader with AI read-aloud. Next.js (App Router) +
Supabase (Postgres, Auth, Storage). EPUBs are parsed entirely client-side
(JSZip + DOMParser); pages are real CSS-column pagination with a page-curl
turn animation; read-aloud runs on the Web Speech API behind a
provider-agnostic interface so a premium TTS API can be swapped in later.

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema — either:
   - **Automatically** (recommended, Prisma/`migrate deploy`-style): fill in
     `DATABASE_URL` in `.env.local` (see below) and run `npm run db:migrate`.
     This applies every not-yet-applied file in `supabase/migrations/*.sql`
     in order and tracks what's been applied in a `public._migrations`
     table, so it's safe to re-run any time you add a new migration file.
   - **Manually**: paste each file in `supabase/migrations/` (in filename
     order) into the Supabase SQL editor yourself.

   Either way, together they create the `books`, `reading_progress`,
   `highlights`, and `reader_settings` tables (with RLS scoped to
   `auth.uid()`), plus a private `library` Storage bucket with per-user
   folder policies.
3. Under **Authentication → Providers**, make sure Email is enabled. No other
   provider or magic-link setup is needed — this app only uses email/password
   signup and login.

## 2. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in your project's values
(Project Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
```

To use `npm run db:migrate`, also add the direct Postgres connection string
from Project Settings → Database → Connection string:

```
DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
```

This is a different, more powerful credential than the anon/service_role
keys above (full DDL access) — it's only ever read by
`scripts/run-migrations.mjs` on your own machine, never bundled into the
app or sent to the client.

`SUPABASE_SERVICE_ROLE_KEY` is server-only — it's used exclusively by
`app/api/account/delete` to remove the Supabase Auth user (which cascades to
all of that user's books/highlights/progress/settings). Never expose it as
`NEXT_PUBLIC_*` or ship it to the client.

`AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` are optional and also server-only —
they power the "Azure Neural (premium)" voice engine option in the reader's
voice settings. Get them from the Azure Portal under your Speech resource's
**Keys and Endpoint** page (the region is the short name, e.g. `eastasia`,
not the full endpoint URL). Leave them unset to use only the free browser
voice, which is the default either way.

## 3. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and upload an
`.epub` file to try it out.

## 4. Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. Add the same environment variables from `.env.local` in the Vercel
   project's Settings → Environment Variables.
3. Deploy. No other build configuration is required.

## Architecture notes

- **EPUB parsing** (`lib/epub/parser.ts`): unzips the EPUB, reads the OPF
  manifest/spine/metadata, resolves the cover and table of contents (EPUB3 nav
  doc or EPUB2 `toc.ncx`), and extracts each spine item's chapter HTML.
- **Sentence segmentation** (`lib/epub/sentences.ts`): wraps every sentence of
  chapter text in a `<span data-sentence-index>` using `Intl.Segmenter`, which
  is what read-aloud highlighting, click-to-read, search, and highlight
  ranges all key off of.
- **Pagination** (`lib/pagination/usePagination.ts`, `components/ReaderPane`):
  CSS multi-column layout sized to the viewport; page turns translate the
  column box by one page-width increment. The page-curl transition clones the
  outgoing page's DOM, rotates it in 3D with a shadow overlay, and removes the
  clone once the rotation finishes — real rendered text curls away rather than
  a rasterized snapshot. Falls back to a plain slide under
  `prefers-reduced-motion`.
- **Text-to-speech** (`lib/tts/TTSProvider.ts`): a small provider interface
  with `WebSpeechProvider` (free, browser-native) and `AzureSpeechProvider`
  (premium, Azure Cognitive Services Speech) implementations, selected per
  user via `getTTSProvider()` in `lib/tts/getTTSProvider.ts`. The reader's
  voice settings popup lets you switch between them; the choice is persisted
  to `reader_settings.tts_provider`. Azure calls go through
  `app/api/tts/azure` and `app/api/tts/azure/voices` (both auth-gated) so the
  subscription key never reaches the browser — the client only ever sees
  synthesized audio bytes back. Speed and volume are applied client-side via
  the `<audio>` element rather than SSML `<prosody>`, since many Azure
  neural voices only partially support prosody rate/volume; pitch is still
  requested via SSML as best-effort.
- **Cross-device sync** (`lib/hooks/useReadingProgress.ts`,
  `useReaderSettings.ts`): both fetch from Supabase on mount and
  debounce-save (~2.5s) on change, with retry-with-backoff on failed writes
  instead of surfacing an error.
- **Progress display**: exact CSS page counts are inherently per-chapter and
  depend on live font size/viewport, so book-wide "percent / Page X of Y /
  time remaining" uses a words-per-page and words-per-minute estimate
  (`lib/reading/progressMath.ts`) rather than a precomputed exact page count
  across the whole book.

## Known limitations / follow-ups worth a second pass

- The page-curl animation and touch-swipe feel are worth a real check on an
  actual tablet — they were built and reasoned through carefully but not
  visually verified on physical touch hardware.
- Sentence segmentation splits per DOM text node, so a sentence that spans an
  inline tag boundary (e.g. "This is *bold* text.") becomes multiple indexed
  fragments rather than one. Fine for TTS/highlighting in practice, but not a
  perfect sentence model.
- Search and highlight matching are plain substring/DOM lookups — fine at the
  "well under 20 books" scale this app is designed for, not built to scale
  further.
