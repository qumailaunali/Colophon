import type { EpubChapter } from "@/lib/epub/types";

const WORDS_PER_PAGE = 275;
const DEFAULT_WORDS_PER_MINUTE = 235;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function chapterWordCount(chapter: Pick<EpubChapter, "sentences">): number {
  return chapter.sentences.reduce((sum, s) => sum + countWords(s.text), 0);
}

/** Per-chapter word counts, stored alongside the TOC so the library grid can
 * show percent/pages/time-remaining without re-downloading and re-parsing
 * every book's EPUB file. */
export function computeChapterWordCounts(chapters: EpubChapter[]): number[] {
  return chapters.map((c) => chapterWordCount(c));
}

export interface ProgressSummary {
  percent: number; // 0-100
  currentPageEstimate: number;
  totalPagesEstimate: number;
  minutesRemaining: number;
}

/**
 * Word-count-based progress model. Exact page counts depend on live font
 * size/viewport (real CSS-column pagination is computed per-chapter as you
 * read), so book-wide "Page X of Y" is a words-per-page estimate rather than
 * a precomputed exact count across the whole book.
 */
export function computeProgressSummary(
  chapterWordCounts: number[],
  spineIndex: number,
  wordsIntoChapter: number
): ProgressSummary {
  const totalWords = Math.max(
    chapterWordCounts.reduce((a, b) => a + b, 0),
    1
  );

  let wordsRead = 0;
  for (let i = 0; i < spineIndex && i < chapterWordCounts.length; i++) {
    wordsRead += chapterWordCounts[i];
  }
  wordsRead += Math.min(wordsIntoChapter, chapterWordCounts[spineIndex] ?? 0);

  const percent = Math.min(100, Math.max(0, (wordsRead / totalWords) * 100));
  const totalPagesEstimate = Math.max(1, Math.round(totalWords / WORDS_PER_PAGE));
  const currentPageEstimate = Math.max(
    1,
    Math.min(totalPagesEstimate, Math.round((wordsRead / totalWords) * totalPagesEstimate))
  );
  const wordsRemaining = Math.max(0, totalWords - wordsRead);
  const minutesRemaining = Math.round(wordsRemaining / DEFAULT_WORDS_PER_MINUTE);

  return { percent, currentPageEstimate, totalPagesEstimate, minutesRemaining };
}

/** Library-card approximation: scales a chapter's total word count by how far
 * through its sentences the saved position is, since the library grid only
 * has per-chapter aggregate counts (stored in books.toc), not full chapter
 * text. */
export function estimateWordsIntoChapter(
  chapterWordCounts: number[],
  chapterSentenceCounts: number[],
  spineIndex: number,
  sentenceIndex: number
): number {
  const totalWords = chapterWordCounts[spineIndex] ?? 0;
  const totalSentences = Math.max(1, chapterSentenceCounts[spineIndex] ?? 1);
  const fraction = Math.min(1, (sentenceIndex + 1) / totalSentences);
  return totalWords * fraction;
}

/** Words read within a chapter up to (and including) a given sentence index. */
export function wordsIntoChapterAtSentence(
  chapter: Pick<EpubChapter, "sentences">,
  sentenceIndex: number
): number {
  let words = 0;
  for (const s of chapter.sentences) {
    if (s.index > sentenceIndex) break;
    words += countWords(s.text);
  }
  return words;
}
