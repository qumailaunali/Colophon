import type { EpubChapter } from "./types";

export interface SearchResult {
  spineIndex: number;
  sentenceIndex: number;
  text: string;
  chapterTitle: string;
}

const MAX_RESULTS = 200;

export function searchChapters(chapters: EpubChapter[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SearchResult[] = [];
  for (const chapter of chapters) {
    for (const sentence of chapter.sentences) {
      if (sentence.text.toLowerCase().includes(q)) {
        results.push({
          spineIndex: chapter.spineIndex,
          sentenceIndex: sentence.index,
          text: sentence.text,
          chapterTitle: chapter.title,
        });
        if (results.length >= MAX_RESULTS) return results;
      }
    }
  }
  return results;
}
