"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { parseEpub } from "@/lib/epub/parser";
import type { EpubChapter } from "@/lib/epub/types";
import type { BookRow, HighlightRow } from "@/lib/supabase/types";
import { useReadingProgress } from "@/lib/hooks/useReadingProgress";
import { useReaderSettings } from "@/lib/hooks/useReaderSettings";
import { useTTSController } from "@/lib/hooks/useTTSController";
import { useSleepTimer } from "@/lib/hooks/useSleepTimer";
import { useKeyboardShortcuts } from "@/lib/hooks/useKeyboardShortcuts";
import { useSidebarToc } from "@/lib/context/SidebarTocContext";
import {
  chapterWordCount,
  computeProgressSummary,
  wordsIntoChapterAtSentence,
} from "@/lib/reading/progressMath";
import { ReaderPane, type ReaderPaneHandle, type SelectionCommit } from "@/components/ReaderPane/ReaderPane";
import { ControlBar } from "@/components/ControlBar/ControlBar";
import { ProgressIndicator } from "@/components/ProgressIndicator/ProgressIndicator";
import { SettingsPanel } from "@/components/SettingsPanel/SettingsPanel";
import { SearchPanel } from "@/components/SearchPanel/SearchPanel";
import { HighlightPopover } from "@/components/Highlights/HighlightPopover";
import styles from "./page.module.css";

export default function BookReaderPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;
  const searchParams = useSearchParams();

  const [book, setBook] = useState<BookRow | null>(null);
  const [chapters, setChapters] = useState<EpubChapter[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [currentSpineIndex, setCurrentSpineIndex] = useState(0);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState<number | null>(null);
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [pendingSelection, setPendingSelection] = useState<SelectionCommit | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageInfo, setPageInfo] = useState({ page: 0, pageCount: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  const readerPaneRef = useRef<ReaderPaneHandle>(null);
  const appliedInitialPositionRef = useRef(false);
  const pendingPageJumpRef = useRef(0);

  const { progress, loaded: progressLoaded, updateProgress } = useReadingProgress(bookId);
  const { settings, loaded: settingsLoaded, updateSettings } = useReaderSettings();
  const { setToc, clearToc, setHidden: setSidebarHidden } = useSidebarToc();

  function handleSentenceChange(spineIndex: number, sentenceIndex: number) {
    setCurrentSentenceIndex(sentenceIndex);
    const pane = readerPaneRef.current;
    pane?.goToSentencePage(sentenceIndex);
    updateProgress({
      spineIndex,
      sentenceIndex,
      scrollOrPageOffset: pane?.getCurrentPage() ?? 0,
    });
  }

  function handleChapterEnd() {
    const nextIndex = currentSpineIndex + 1;
    if (nextIndex >= chapters.length) return;
    navigateToChapter(nextIndex, 0);
    setTimeout(() => ttsController.play(chapters[nextIndex], 0), 50);
  }

  const ttsController = useTTSController({
    settings,
    onSentenceChange: handleSentenceChange,
    onChapterEnd: handleChapterEnd,
  });

  const sleepTimer = useSleepTimer(() => ttsController.pause());

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  // Focus mode: hides the nav sidebar and the control bar, leaving only the
  // reading pane. Independent of browser fullscreen — can be combined with
  // it or used on its own.
  useEffect(() => {
    setSidebarHidden(focusMode);
  }, [focusMode, setSidebarHidden]);

  async function loadBook() {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const supabase = createClient();
      const { data: bookRow, error: bookErr } = await supabase
        .from("books")
        .select("*")
        .eq("id", bookId)
        .single();
      if (bookErr || !bookRow) throw new Error("Book not found");

      const { data: blob, error: downloadErr } = await supabase.storage
        .from("library")
        .download(bookRow.file_path);
      if (downloadErr || !blob) throw new Error("Could not download the EPUB file");

      const parsed = await parseEpub(blob);

      const { data: highlightRows } = await supabase
        .from("highlights")
        .select("*")
        .eq("book_id", bookId);

      setBook(bookRow);
      setChapters(parsed.chapters);
      setHighlights(highlightRows ?? []);
      setLoadState("ready");
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Something went wrong loading this book.");
      setLoadState("error");
    }
  }

  useEffect(() => {
    appliedInitialPositionRef.current = false;
    loadBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // Apply the saved cross-device position once, after both the book and its
  // progress row have loaded.
  useEffect(() => {
    if (!chapters.length || !progressLoaded || appliedInitialPositionRef.current) return;
    appliedInitialPositionRef.current = true;

    const qSpine = searchParams.get("spine");
    const qSentence = searchParams.get("sentence");
    const spineIndex = Math.min(
      qSpine != null ? Number(qSpine) : progress.spineIndex,
      chapters.length - 1
    );
    const sentenceIndex = qSpine != null ? Number(qSentence ?? 0) : progress.sentenceIndex;

    pendingPageJumpRef.current = sentenceIndex;
    setCurrentSpineIndex(spineIndex);
    setCurrentSentenceIndex(sentenceIndex);
    ttsController.setChapter(chapters[spineIndex], sentenceIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, progressLoaded]);

  // Jump to the right page whenever the visible chapter changes.
  useEffect(() => {
    const target = pendingPageJumpRef.current;
    const id = requestAnimationFrame(() => {
      readerPaneRef.current?.goToSentencePage(target);
    });
    return () => cancelAnimationFrame(id);
  }, [currentSpineIndex]);

  function navigateToChapter(spineIndex: number, sentenceIndex = 0) {
    if (!chapters.length) return;
    const clamped = Math.max(0, Math.min(spineIndex, chapters.length - 1));
    pendingPageJumpRef.current = sentenceIndex;
    setCurrentSpineIndex(clamped);
    setCurrentSentenceIndex(sentenceIndex);
    ttsController.setChapter(chapters[clamped], sentenceIndex);
    updateProgress({ spineIndex: clamped, sentenceIndex, scrollOrPageOffset: 0 });
  }

  useEffect(() => {
    if (!book || !chapters.length) return;
    setToc({
      bookTitle: book.title,
      entries: book.toc.entries,
      currentSpineIndex,
      onSelect: (spineIndex) => {
        ttsController.pause();
        navigateToChapter(spineIndex, 0);
      },
    });
    return () => clearToc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapters.length, currentSpineIndex]);

  function handleNextPage() {
    const advanced = readerPaneRef.current?.nextPage();
    if (advanced === false && currentSpineIndex + 1 < chapters.length) {
      navigateToChapter(currentSpineIndex + 1, 0);
    }
  }

  function handlePrevPage() {
    const advanced = readerPaneRef.current?.prevPage();
    if (advanced === false && currentSpineIndex - 1 >= 0) {
      navigateToChapter(currentSpineIndex - 1, 0);
    }
  }

  useKeyboardShortcuts({
    onPrevPage: handlePrevPage,
    onNextPage: handleNextPage,
    onTogglePlay: ttsController.togglePlayPause,
  });

  function handleSentenceClick(sentenceIndex: number) {
    setCurrentSentenceIndex(sentenceIndex);
    ttsController.play(chapters[currentSpineIndex], sentenceIndex);
  }

  async function saveHighlight(color: string, note: string) {
    if (!pendingSelection || !book) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("highlights")
      .insert({
        user_id: user.id,
        book_id: book.id,
        spine_index: currentSpineIndex,
        sentence_index_start: pendingSelection.start,
        sentence_index_end: pendingSelection.end,
        text_snippet: pendingSelection.text,
        color,
        note: note || null,
      })
      .select()
      .single();

    if (!error && data) setHighlights((prev) => [...prev, data]);
    setPendingSelection(null);
  }

  const chapterWordCounts = useMemo(() => chapters.map((c) => chapterWordCount(c)), [chapters]);

  const summary = useMemo(() => {
    if (!chapters.length || currentSentenceIndex == null) return null;
    const wordsIntoChapter = wordsIntoChapterAtSentence(
      chapters[currentSpineIndex],
      currentSentenceIndex
    );
    return computeProgressSummary(chapterWordCounts, currentSpineIndex, wordsIntoChapter);
  }, [chapters, chapterWordCounts, currentSpineIndex, currentSentenceIndex]);

  const currentChapterHighlights = useMemo(
    () => highlights.filter((h) => h.spine_index === currentSpineIndex),
    [highlights, currentSpineIndex]
  );

  if (loadState === "loading" || !settingsLoaded) {
    return <div className={styles.centerState}>Loading book…</div>;
  }

  if (loadState === "error" || !book) {
    return (
      <div className={styles.centerState}>
        <p>{errorMessage ?? "Could not load this book."}</p>
        <button className={styles.retryButton} onClick={loadBook}>
          Retry
        </button>
      </div>
    );
  }

  const chapter = chapters[currentSpineIndex];

  return (
    <div className={styles.bookPage}>
      {!focusMode && (
        <div className={styles.topBar}>
          <Link href="/library" className={styles.backLink}>
            ‹ Library
          </Link>
          <div className={styles.bookTitle}>{book.title}</div>
          <div className={styles.topActions}>
            <button onClick={() => setShowSearch(true)}>Search</button>
            <Link href={`/book/${book.id}/highlights`}>Highlights</Link>
            <button onClick={() => setShowSettings(true)}>Aa</button>
            <button onClick={toggleFullscreen} aria-label="Toggle fullscreen" title="Toggle fullscreen">
              {isFullscreen ? "⤡" : "⛶"}
            </button>
            <button onClick={() => setFocusMode(true)} aria-label="Focus mode" title="Focus mode: hide sidebar and controls">
              Focus
            </button>
          </div>
        </div>
      )}

      {focusMode && (
        <>
          <button
            className={styles.exitFocusButton}
            onClick={() => setFocusMode(false)}
            aria-label="Exit focus mode"
            title="Exit focus mode"
          >
            ✕
          </button>
          <button
            className={styles.focusPlayButton}
            onClick={ttsController.togglePlayPause}
            aria-label={ttsController.isPlaying ? "Pause" : "Play"}
            title={ttsController.isPlaying ? "Pause" : "Play"}
          >
            {ttsController.isPlaying ? "❚❚" : "▶"}
          </button>
        </>
      )}

      <div className={`${styles.readerArea} ${focusMode ? styles.readerAreaFocus : ""}`}>
        {ttsController.lastError && (
          <div className={styles.ttsErrorBanner}>
            <span>Read-aloud error: {ttsController.lastError}</span>
            <button onClick={ttsController.clearError} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}
        <div className={styles.paginationRow}>
          {!focusMode && (
            <button
              className={styles.turnButton}
              onClick={handlePrevPage}
              disabled={pageInfo.page === 0 && currentSpineIndex === 0}
              aria-label="Previous page"
            >
              ‹
            </button>
          )}
          <div className={styles.readerPaneWrap}>
            {chapter && (
              <ReaderPane
                ref={readerPaneRef}
                html={chapter.html}
                contentKey={`${book.id}:${chapter.spineIndex}`}
                fontFamily={settings.fontFamily}
                fontSize={settings.fontSize}
                lineSpacing={settings.lineSpacing}
                theme={settings.theme}
                currentSentenceIndex={currentSentenceIndex}
                highlights={currentChapterHighlights}
                reducedMotion={reducedMotion}
                onPageChange={(page, pageCount) => setPageInfo({ page, pageCount })}
                onSentenceClick={handleSentenceClick}
                onSelectionCommit={setPendingSelection}
              />
            )}
          </div>
          {!focusMode && (
            <button
              className={styles.turnButton}
              onClick={handleNextPage}
              disabled={
                pageInfo.page >= pageInfo.pageCount - 1 && currentSpineIndex >= chapters.length - 1
              }
              aria-label="Next page"
            >
              ›
            </button>
          )}
        </div>

        {summary && (
          <div className={styles.progressRow}>
            <ProgressIndicator
              percent={summary.percent}
              currentPage={summary.currentPageEstimate}
              totalPages={summary.totalPagesEstimate}
              minutesRemaining={summary.minutesRemaining}
              onDark
            />
          </div>
        )}
      </div>

      {!focusMode && (
        <ControlBar
          isPlaying={ttsController.isPlaying}
          onTogglePlay={ttsController.togglePlayPause}
          onStop={ttsController.stop}
          onPrevChapter={() => {
            ttsController.pause();
            navigateToChapter(currentSpineIndex - 1, 0);
          }}
          onNextChapter={() => {
            ttsController.pause();
            navigateToChapter(currentSpineIndex + 1, 0);
          }}
          ttsProvider={settings.ttsProvider}
          onTtsProviderChange={(kind) => updateSettings({ ttsProvider: kind, voiceName: null })}
          voices={ttsController.voices}
          voiceName={settings.voiceName}
          onVoiceChange={(name) => updateSettings({ voiceName: name || null })}
          speechRate={settings.speechRate}
          onRateChange={(rate) => updateSettings({ speechRate: rate })}
          speechPitch={settings.speechPitch}
          onPitchChange={(pitch) => updateSettings({ speechPitch: pitch })}
          speechVolume={settings.speechVolume}
          onVolumeChange={(volume) => updateSettings({ speechVolume: volume })}
          sleepMinutesRemaining={sleepTimer.minutesRemaining}
          onSetSleepTimer={(minutes) => (minutes ? sleepTimer.start(minutes) : sleepTimer.cancel())}
        />
      )}

      {showSettings && (
        <div className={styles.settingsOverlay} onClick={() => setShowSettings(false)}>
          <div className={styles.settingsCard} onClick={(e) => e.stopPropagation()}>
            <h2>Display settings</h2>
            <SettingsPanel settings={settings} onChange={updateSettings} />
            <button className={styles.settingsClose} onClick={() => setShowSettings(false)}>
              Done
            </button>
          </div>
        </div>
      )}

      {showSearch && (
        <SearchPanel
          chapters={chapters}
          onClose={() => setShowSearch(false)}
          onJump={(spineIndex, sentenceIndex) => {
            ttsController.pause();
            navigateToChapter(spineIndex, sentenceIndex);
          }}
        />
      )}

      {pendingSelection && (
        <HighlightPopover
          snippet={pendingSelection.text}
          onSave={saveHighlight}
          onCancel={() => setPendingSelection(null)}
        />
      )}
    </div>
  );
}
