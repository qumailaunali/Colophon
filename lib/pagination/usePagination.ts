"use client";

import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

/**
 * CSS-column pagination: measuring `columns.clientWidth` before column-width
 * is applied gives the single-page width (the box is always 100% of its
 * parent regardless of how many columns the content overflows into), so a
 * two-phase layout-effect chain first captures that width, re-renders with
 * `column-width` set to it, then measures `scrollWidth` to get the total
 * page count for this chapter.
 */
export function usePagination(
  viewportRef: RefObject<HTMLDivElement | null>,
  columnsRef: RefObject<HTMLDivElement | null>,
  contentKey: string
) {
  const [pageWidth, setPageWidth] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  const measureWidth = useCallback(() => {
    const columns = columnsRef.current;
    if (!columns) return;
    // Floor to a whole pixel: browsers render `column-width` most reliably
    // at integer values, and setting column-width/translateX from the same
    // fractional getBoundingClientRect() value can render the actual column
    // a hair wider than we compute, leaving a sliver of the previous page
    // visible after a page turn.
    setPageWidth(Math.floor(columns.getBoundingClientRect().width));
  }, [columnsRef]);

  useLayoutEffect(() => {
    measureWidth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  useLayoutEffect(() => {
    const columns = columnsRef.current;
    if (!columns || pageWidth === 0) return;
    const count = Math.max(1, Math.round(columns.scrollWidth / pageWidth));
    setPageCount(count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageWidth, contentKey]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureWidth());
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [viewportRef, measureWidth]);

  const getSentencePage = useCallback(
    (sentenceIndex: number): number => {
      const columns = columnsRef.current;
      if (!columns || pageWidth === 0) return 0;
      const el = columns.querySelector<HTMLElement>(
        `[data-sentence-index="${sentenceIndex}"]`
      );
      if (!el) return 0;
      return Math.floor(el.offsetLeft / pageWidth);
    },
    [columnsRef, pageWidth]
  );

  return { pageWidth, pageCount, getSentencePage };
}
