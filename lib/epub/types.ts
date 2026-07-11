import type { TocEntry } from "@/lib/supabase/types";

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

export interface EpubSentence {
  index: number;
  text: string;
}

export interface EpubChapter {
  spineIndex: number;
  id: string;
  href: string;
  title: string;
  /** Body innerHTML with every sentence wrapped in <span data-sentence-index>. */
  html: string;
  sentences: EpubSentence[];
}

export interface ParsedEpub {
  title: string;
  author: string | null;
  coverBlob: Blob | null;
  coverMediaType: string | null;
  toc: TocEntry[];
  chapters: EpubChapter[];
}
