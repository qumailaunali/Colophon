"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { computeProgressSummary, estimateWordsIntoChapter } from "@/lib/reading/progressMath";
import { ProgressIndicator } from "@/components/ProgressIndicator/ProgressIndicator";
import type { BookRow, ReadingProgressRow } from "@/lib/supabase/types";
import styles from "./LibraryGrid.module.css";

interface LibraryGridProps {
  books: BookRow[];
  progressByBook: Record<string, ReadingProgressRow>;
  coverUrls: Record<string, string>;
  onDelete: (bookId: string) => void;
}

export function LibraryGrid({ books, progressByBook, coverUrls, onDelete }: LibraryGridProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenuId]);

  if (books.length === 0) {
    return (
      <div className={styles.empty}>
        Your library is empty. Add your first book to get started.
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {books.map((book) => {
        const progress = progressByBook[book.id];
        const { chapterWordCounts, chapterSentenceCounts } = book.toc;
        const spineIndex = progress?.spine_index ?? 0;
        const sentenceIndex = progress?.sentence_index ?? 0;
        const wordsIntoChapter = estimateWordsIntoChapter(
          chapterWordCounts,
          chapterSentenceCounts,
          spineIndex,
          sentenceIndex
        );
        const summary = computeProgressSummary(chapterWordCounts, spineIndex, wordsIntoChapter);

        return (
          <div key={book.id} className={styles.card}>
            <div className={styles.coverWrap}>
              <Link href={`/book/${book.id}`} className={styles.coverLink}>
                {coverUrls[book.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrls[book.id]} alt={book.title} className={styles.cover} />
                ) : (
                  <div className={styles.coverPlaceholder}>{book.title[0]}</div>
                )}
              </Link>
              <div
                className={styles.menuContainer}
                ref={openMenuId === book.id ? menuRef : null}
              >
                <button
                  type="button"
                  className={styles.menuButton}
                  aria-label="Book options"
                  aria-expanded={openMenuId === book.id}
                  onClick={() => setOpenMenuId(openMenuId === book.id ? null : book.id)}
                >
                  ⋮
                </button>
                {openMenuId === book.id && (
                  <div className={styles.menuDropdown}>
                    <button
                      type="button"
                      className={styles.menuItem}
                      onClick={() => {
                        setOpenMenuId(null);
                        onDelete(book.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className={styles.info}>
              <Link href={`/book/${book.id}`} className={styles.title}>
                {book.title}
              </Link>
              {book.author && <div className={styles.author}>{book.author}</div>}
              <ProgressIndicator
                percent={summary.percent}
                currentPage={summary.currentPageEstimate}
                totalPages={summary.totalPagesEstimate}
                minutesRemaining={summary.minutesRemaining}
                compact
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
