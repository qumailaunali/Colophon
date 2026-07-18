export type ReaderTheme = "paper" | "sepia" | "dark";
export type TtsProviderKind = "webspeech" | "azure" | "edge";

export type TocEntry = {
  label: string;
  href: string;
  spineIndex: number;
  children?: TocEntry[];
};

/** Stored in books.toc (jsonb) so the library grid can derive progress
 * without re-downloading/re-parsing the EPUB file. */
export type BookTocData = {
  entries: TocEntry[];
  chapterWordCounts: number[];
  chapterSentenceCounts: number[];
};

export type BookRow = {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  cover_path: string | null;
  file_path: string;
  toc: BookTocData;
  created_at: string;
};

export type ReadingProgressRow = {
  id: string;
  user_id: string;
  book_id: string;
  spine_index: number;
  sentence_index: number;
  scroll_or_page_offset: number;
  updated_at: string;
};

export type HighlightRow = {
  id: string;
  user_id: string;
  book_id: string;
  spine_index: number;
  sentence_index_start: number;
  sentence_index_end: number;
  text_snippet: string;
  color: string;
  note: string | null;
  created_at: string;
};

export type BookmarkRow = {
  id: string;
  user_id: string;
  book_id: string;
  spine_index: number;
  sentence_index: number;
  scroll_or_page_offset: number;
  page_info: string;
  created_at: string;
};


export type ReaderSettingsRow = {
  id: string;
  user_id: string;
  font_family: string;
  font_size: number;
  line_spacing: number;
  theme: ReaderTheme;
  voice_name: string | null;
  speech_rate: number;
  speech_pitch: number;
  speech_volume: number;
  tts_provider: TtsProviderKind;
  updated_at: string;
};

export type OpenLibraryBookRow = {
  id: string;
  title: string;
  author: string | null;
  cover_path: string | null;
  file_path: string;
  toc: BookTocData;
  uploader_email: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      books: {
        Row: BookRow;
        Insert: Omit<BookRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<BookRow, "id" | "user_id">>;
        Relationships: [];
      };
      reading_progress: {
        Row: ReadingProgressRow;
        Insert: Omit<ReadingProgressRow, "id" | "updated_at"> & {
          id?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ReadingProgressRow, "id" | "user_id" | "book_id">>;
        Relationships: [];
      };
      highlights: {
        Row: HighlightRow;
        Insert: Omit<HighlightRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<HighlightRow, "id" | "user_id" | "book_id">>;
        Relationships: [];
      };
      bookmarks: {
        Row: BookmarkRow;
        Insert: Omit<BookmarkRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<BookmarkRow, "id" | "user_id" | "book_id">>;
        Relationships: [];
      };
      reader_settings: {
        Row: ReaderSettingsRow;
        Insert: Omit<ReaderSettingsRow, "id" | "updated_at"> & {
          id?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ReaderSettingsRow, "id" | "user_id">>;
        Relationships: [];
      };
      open_library_books: {
        Row: OpenLibraryBookRow;
        Insert: Omit<OpenLibraryBookRow, "id" | "created_at"> & { id?: string };
        Update: Partial<Omit<OpenLibraryBookRow, "id">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
