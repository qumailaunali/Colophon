"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { HighlightRow, ReaderTheme } from "@/lib/supabase/types";
import { usePagination } from "@/lib/pagination/usePagination";
import { RibbonBookmark } from "./RibbonBookmark";
import styles from "./ReaderPane.module.css";

// Deliberately far larger than any real viewport: with `column-width` this
// oversized, the browser can never fit two columns side-by-side (it always
// falls back to a single column spanning the full available width). Text
// still overflows into additional same-width columns for later pages
// exactly as before — this just makes "exactly one column per page"
// structurally guaranteed instead of depending on our own JS-measured
// width matching the browser's layout to the pixel, which could drift out
// of sync (e.g. after a container resize) and show a sliver of the
// adjacent page.
const FORCE_SINGLE_COLUMN_WIDTH = 100000;

export interface ReaderPaneHandle {
  /** Returns false if already at the last page (caller should advance chapter). */
  nextPage: () => boolean;
  /** Returns false if already at the first page (caller should go to previous chapter). */
  prevPage: () => boolean;
  goToPage: (page: number) => void;
  goToSentencePage: (sentenceIndex: number) => void;
  getPageCount: () => number;
  getCurrentPage: () => number;
}

export interface SelectionCommit {
  start: number;
  end: number;
  text: string;
}

interface ReaderPaneProps {
  html: string;
  contentKey: string;
  fontFamily: string;
  fontSize: number;
  lineSpacing: number;
  theme: ReaderTheme;
  currentSentenceIndex: number | null;
  highlights: HighlightRow[];
  reducedMotion: boolean;
  initialPage?: number;
  onPageChange: (page: number, pageCount: number) => void;
  onSentenceClick: (sentenceIndex: number) => void;
  onSelectionCommit: (selection: SelectionCommit) => void;
}

export const ReaderPane = forwardRef<ReaderPaneHandle, ReaderPaneProps>(function ReaderPane(
  {
    html,
    contentKey,
    fontFamily,
    fontSize,
    lineSpacing,
    theme,
    currentSentenceIndex,
    highlights,
    reducedMotion,
    initialPage,
    onPageChange,
    onSentenceClick,
    onSelectionCommit,
  },
  ref
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const overlayHostRef = useRef<HTMLDivElement>(null);

  const { pageWidth, pageCount, getSentencePage } = usePagination(
    viewportRef,
    columnsRef,
    `${contentKey}:${fontFamily}:${fontSize}:${lineSpacing}`
  );

  const [currentPage, setCurrentPageState] = useState(initialPage ?? 0);
  const currentPageRef = useRef(currentPage);
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;

  // Clamp/reset the visible page whenever the chapter content or page width changes.
  useEffect(() => {
    const clamped = Math.min(initialPage ?? 0, Math.max(0, pageCount - 1));
    currentPageRef.current = clamped;
    setCurrentPageState(clamped);
    // Intentionally re-runs only when the chapter/font-key changes, not on
    // every pageCount recalculation from ResizeObserver — otherwise resizing
    // the window would keep resetting the reader back to `initialPage`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  const setPage = useCallback(
    (page: number) => {
      currentPageRef.current = page;
      setCurrentPageState(page);
      onPageChange(page, pageCountRef.current);
    },
    [onPageChange]
  );

  const animateTurn = useCallback(
    (direction: 1 | -1, nextPageIndex: number) => {
      const columns = columnsRef.current;
      const host = overlayHostRef.current;

      if (!columns || !host || reducedMotion || pageWidth === 0) {
        setPage(nextPageIndex);
        return;
      }

      const clone = columns.cloneNode(true) as HTMLElement;
      clone.style.transform = `translateX(-${currentPageRef.current * pageWidth}px)`;
      clone.style.transition = "none";

      const wrapper = document.createElement("div");
      wrapper.className = styles.curlClone;
      wrapper.style.width = `${pageWidth}px`;
      wrapper.appendChild(clone);
      host.appendChild(wrapper);

      // Force a reflow so the transition below is picked up.
      void wrapper.offsetWidth;
      wrapper.classList.add(direction === 1 ? styles.turningNext : styles.turningPrev);

      setPage(nextPageIndex);

      const cleanup = () => {
        wrapper.removeEventListener("transitionend", cleanup);
        wrapper.remove();
      };
      wrapper.addEventListener("transitionend", cleanup);
      setTimeout(cleanup, 650);
    },
    [pageWidth, reducedMotion, setPage]
  );

  useImperativeHandle(
    ref,
    () => ({
      nextPage: () => {
        const next = currentPageRef.current + 1;
        if (next >= pageCountRef.current) return false;
        animateTurn(1, next);
        return true;
      },
      prevPage: () => {
        const prev = currentPageRef.current - 1;
        if (prev < 0) return false;
        animateTurn(-1, prev);
        return true;
      },
      goToPage: (page: number) => {
        const clamped = Math.max(0, Math.min(page, pageCountRef.current - 1));
        setPage(clamped);
      },
      goToSentencePage: (sentenceIndex: number) => {
        setPage(getSentencePage(sentenceIndex));
      },
      getPageCount: () => pageCountRef.current,
      getCurrentPage: () => currentPageRef.current,
    }),
    [animateTurn, getSentencePage, setPage]
  );

  // Toggle the currently-spoken sentence highlight.
  useEffect(() => {
    const columns = columnsRef.current;
    if (!columns) return;
    columns.querySelectorAll('[data-speaking="true"]').forEach((el) => {
      el.removeAttribute("data-speaking");
    });
    if (currentSentenceIndex != null) {
      columns.querySelectorAll(`[data-sentence-index="${currentSentenceIndex}"]`).forEach((el) => {
        el.setAttribute("data-speaking", "true");
      });
    }
  }, [currentSentenceIndex, html]);

  // Apply saved highlights as translucent background colors.
  useEffect(() => {
    const columns = columnsRef.current;
    if (!columns) return;
    columns.querySelectorAll<HTMLElement>("[data-highlight-id]").forEach((el) => {
      el.removeAttribute("data-highlight-id");
      el.style.backgroundColor = "";
    });
    highlights.forEach((h) => {
      for (let i = h.sentence_index_start; i <= h.sentence_index_end; i++) {
        columns.querySelectorAll<HTMLElement>(`[data-sentence-index="${i}"]`).forEach((el) => {
          el.style.backgroundColor = `${h.color}55`;
          el.setAttribute("data-highlight-id", h.id);
        });
      }
    });
  }, [html, highlights]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest("[data-sentence-index]");
    if (!target) return;
    onSentenceClick(Number(target.getAttribute("data-sentence-index")));
  }

  function handleMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const anchorEl = (sel.anchorNode?.parentElement)?.closest("[data-sentence-index]");
    const focusEl = (sel.focusNode?.parentElement)?.closest("[data-sentence-index]");
    if (!anchorEl || !focusEl) return;
    const a = Number(anchorEl.getAttribute("data-sentence-index"));
    const b = Number(focusEl.getAttribute("data-sentence-index"));
    onSelectionCommit({
      start: Math.min(a, b),
      end: Math.max(a, b),
      text: sel.toString().trim(),
    });
  }

  // Touch swipe navigation.
  const touchStartX = useRef<number | null>(null);
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 50) return;
    if (delta < 0) {
      const next = currentPageRef.current + 1;
      if (next < pageCountRef.current) animateTurn(1, next);
    } else {
      const prev = currentPageRef.current - 1;
      if (prev >= 0) animateTurn(-1, prev);
    }
  }

  return (
    <div ref={viewportRef} className={styles.viewport} data-reader-theme={theme}>
      <div className={styles.clipContainer}>
        <div
          ref={columnsRef}
          className={styles.columns}
          style={{
            columnWidth: pageWidth > 0 ? FORCE_SINGLE_COLUMN_WIDTH : undefined,
            transform: `translateX(-${currentPage * pageWidth}px)`,
            fontSize: `${fontSize}px`,
            lineHeight: lineSpacing,
            fontFamily: fontFamily || undefined,
          }}
          onClick={handleClick}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <div ref={overlayHostRef} className={styles.overlayHost} />
      </div>
      <RibbonBookmark progress={pageCount > 0 ? (currentPage + 1) / pageCount : 0} />
    </div>
  );
});
