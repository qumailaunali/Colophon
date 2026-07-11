"use client";

import { useMemo, useState } from "react";
import { searchChapters } from "@/lib/epub/search";
import type { EpubChapter } from "@/lib/epub/types";
import styles from "./SearchPanel.module.css";

interface SearchPanelProps {
  chapters: EpubChapter[];
  onJump: (spineIndex: number, sentenceIndex: number) => void;
  onClose: () => void;
}

export function SearchPanel({ chapters, onJump, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchChapters(chapters, query), [chapters, query]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className={styles.input}
          placeholder="Search this book…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.results}>
          {query.trim() && results.length === 0 && (
            <div className={styles.empty}>No matches.</div>
          )}
          {results.map((r) => (
            <button
              key={`${r.spineIndex}-${r.sentenceIndex}`}
              className={styles.result}
              onClick={() => {
                onJump(r.spineIndex, r.sentenceIndex);
                onClose();
              }}
            >
              <div className={styles.resultChapter}>{r.chapterTitle}</div>
              <div className={styles.resultText}>{r.text}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
