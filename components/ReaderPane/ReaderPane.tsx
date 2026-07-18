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
  getFirstSentenceOnPage: () => number;
  getActivePageText: () => string;
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
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onWordLookup?: (word: string) => void;
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
    onPrevPage,
    onNextPage,
    onWordLookup,
  },
  ref
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const overlayHostRef = useRef<HTMLDivElement>(null);

  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPressTimer = useCallback(() => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, []);

  const startLongPressTimer = useCallback((clientX: number, clientY: number) => {
    cancelLongPressTimer();
    touchStartPosRef.current = { x: clientX, y: clientY };
    longPressTimeoutRef.current = setTimeout(() => {
      const word = getWordAtPoint(clientX, clientY);
      if (word && word.length > 1) {
        onWordLookup?.(word);
      }
      touchStartPosRef.current = null;
    }, 600);
  }, [cancelLongPressTimer, onWordLookup]);

  useEffect(() => {
    return () => {
      cancelLongPressTimer();
    };
  }, [cancelLongPressTimer]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    startLongPressTimer(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!touchStartPosRef.current) return;
    const dx = Math.abs(e.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(e.clientY - touchStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      cancelLongPressTimer();
      touchStartPosRef.current = null;
    }
  };

  const { pageWidth, pageCount, getSentencePage } = usePagination(
    viewportRef,
    columnsRef,
    `${contentKey}:${fontFamily}:${fontSize}:${lineSpacing}`
  );

  const [currentPage, setCurrentPageState] = useState(initialPage ?? 0);
  const currentPageRef = useRef(currentPage);
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;

  const [disableTransition, setDisableTransition] = useState(false);
  const [prevContentKey, setPrevContentKey] = useState(contentKey);

  // Synchronously reset page and disable transition during render when chapter changes
  if (contentKey !== prevContentKey) {
    setPrevContentKey(contentKey);
    setDisableTransition(true);
    const clamped = Math.min(initialPage ?? 0, Math.max(0, pageCount - 1));
    currentPageRef.current = clamped;
    setCurrentPageState(clamped);
  }

  // Restore transition state in next tick
  useEffect(() => {
    if (disableTransition) {
      const id = requestAnimationFrame(() => {
        setDisableTransition(false);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [disableTransition]);

  const setPage = useCallback(
    (page: number) => {
      currentPageRef.current = page;
      setCurrentPageState(page);
      onPageChange(page, pageCountRef.current);
    },
    [onPageChange]
  );

  const animateTurn = useCallback(
    (direction: 1 | -1, nextPageIndex?: number) => {
      const columns = columnsRef.current;
      const host = overlayHostRef.current;

      if (!columns || !host || reducedMotion || pageWidth === 0) {
        if (nextPageIndex !== undefined) {
          setPage(nextPageIndex);
        }
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

      if (nextPageIndex !== undefined) {
        setPage(nextPageIndex);
      }

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
        if (next >= pageCountRef.current) {
          animateTurn(1);
          return false;
        }
        animateTurn(1, next);
        return true;
      },
      prevPage: () => {
        const prev = currentPageRef.current - 1;
        if (prev < 0) {
          animateTurn(-1);
          return false;
        }
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
      getFirstSentenceOnPage: () => {
        const columns = columnsRef.current;
        if (!columns || pageWidth === 0) return 0;
        const els = columns.querySelectorAll<HTMLElement>("[data-sentence-index]");
        for (let i = 0; i < els.length; i++) {
          const el = els[i];
          const page = Math.floor(el.offsetLeft / pageWidth);
          if (page === currentPageRef.current) {
            return Number(el.getAttribute("data-sentence-index"));
          }
        }
        return 0;
      },
      getActivePageText: () => {
        const columns = columnsRef.current;
        if (!columns || pageWidth === 0) return "";
        const els = columns.querySelectorAll<HTMLElement>("[data-sentence-index]");
        let text = "";
        els.forEach((el) => {
          const page = Math.floor(el.offsetLeft / pageWidth);
          if (page === currentPageRef.current) {
            text += (el.textContent || el.innerText || "") + " ";
          }
        });
        return text.trim();
      },
    }),
    [animateTurn, getSentencePage, setPage, pageWidth]
  );

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
    cancelLongPressTimer();
    touchStartPosRef.current = null;

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
    const t = e.touches[0];
    startLongPressTimer(t.clientX, t.clientY);
  }
  function handleTouchMove(e: React.TouchEvent) {
    if (!touchStartPosRef.current) return;
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(t.clientY - touchStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      cancelLongPressTimer();
      touchStartPosRef.current = null;
    }
  }
  function handleTouchCancel() {
    cancelLongPressTimer();
    touchStartPosRef.current = null;
    touchStartX.current = null;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    cancelLongPressTimer();
    touchStartPosRef.current = null;

    if (touchStartX.current == null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 50) return;
    if (delta < 0) {
      const next = currentPageRef.current + 1;
      if (next < pageCountRef.current) {
        animateTurn(1, next);
      } else {
        onNextPage?.();
      }
    } else {
      const prev = currentPageRef.current - 1;
      if (prev >= 0) {
        animateTurn(-1, prev);
      } else {
        onPrevPage?.();
      }
    }
  }

  return (
    <div
      ref={viewportRef}
      className={styles.viewport}
      data-reader-theme={theme}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <div className={styles.clipContainer}>
        {/* Highlighting the actively-spoken sentence via a scoped stylesheet
            (rather than imperatively mutating the dangerouslySetInnerHTML
            subtree below) means it's driven purely by React re-rendering
            this text — it can never go stale relative to whatever DOM the
            browser is currently showing, no matter when/why that subtree
            gets reset. */}
        {Number.isInteger(currentSentenceIndex) && (
          <style>{`[data-sentence-index="${currentSentenceIndex}"] { background-color: rgba(201, 162, 39, 0.45) !important; }`}</style>
        )}
        <div
          ref={columnsRef}
          key={contentKey}
          className={styles.columns}
          style={{
            columnWidth: pageWidth > 0 ? FORCE_SINGLE_COLUMN_WIDTH : undefined,
            transform: `translateX(-${currentPage * pageWidth}px)`,
            transition: disableTransition ? "none" : undefined,
            fontSize: `${fontSize}px`,
            lineHeight: lineSpacing,
            fontFamily: fontFamily || undefined,
          }}
          onClick={handleClick}
          onMouseUp={handleMouseUp}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <div ref={overlayHostRef} className={styles.overlayHost} />
      </div>
      <RibbonBookmark progress={pageCount > 0 ? (currentPage + 1) / pageCount : 0} />
    </div>
  );
});

function getWordAtPoint(x: number, y: number): string | null {
  let range: Range | null = null;
  let textNode: Node | null = null;
  let offset = 0;

  if (typeof document === "undefined") return null;

  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
    if (range) {
      textNode = range.startContainer;
      offset = range.startOffset;
    }
  } else if ((document as any).caretPositionFromPoint) {
    const position = (document as any).caretPositionFromPoint(x, y);
    if (position) {
      textNode = position.offsetNode;
      offset = position.offset;
    }
  }

  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    const text = textNode.nodeValue || "";
    const isWordChar = (char: string) => /[a-zA-Z0-9'-]/.test(char);

    let start = offset;
    while (start > 0 && isWordChar(text[start - 1])) {
      start--;
    }
    let end = offset;
    while (end < text.length && isWordChar(text[end])) {
      end++;
    }
    const word = text.slice(start, end);
    return word.trim();
  }
  return null;
}
