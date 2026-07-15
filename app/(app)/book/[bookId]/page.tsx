"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { parseEpub } from "@/lib/epub/parser";
import type { EpubChapter } from "@/lib/epub/types";
import type { BookRow, HighlightRow, BookmarkRow } from "@/lib/supabase/types";
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
import { DictionaryPopover } from "@/components/Dictionary/DictionaryPopover";
import styles from "./page.module.css";
import { HighlightIcon } from "@/components/Icons/HighlightIcon";

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
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [pendingSelection, setPendingSelection] = useState<SelectionCommit | null>(null);

  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [aiAction, setAiAction] = useState<"idle" | "summarizing" | "generating_flashcards" | "chat_answering">("idle");
  const [aiSummary, setAiSummary] = useState<string[] | null>(null);
  const [aiFlashcards, setAiFlashcards] = useState<{ question: string; answer: string }[] | null>(null);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiActiveTab, setAiActiveTab] = useState<"none" | "summary" | "flashcards" | "chat">("none");
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [lookupWord, setLookupWord] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageInfo, setPageInfo] = useState({ page: 0, pageCount: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleTouchStart = (label: string) => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = setTimeout(() => {
      setActiveTooltip(label);
    }, 450); // standard long-press duration
  };

  const handleTouchEnd = () => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setActiveTooltip(null);
  };

  const isCurrentPageBookmarked = useMemo(() => {
    return bookmarks.some(
      (b) => b.spine_index === currentSpineIndex && b.scroll_or_page_offset === pageInfo.page
    );
  }, [bookmarks, currentSpineIndex, pageInfo.page]);

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

  // Clear AI data when closing the helper modal
  useEffect(() => {
    if (!showAiModal) {
      setAiSummary(null);
      setAiFlashcards(null);
      setAiError(null);
      setAiAction("idle");
      setAiActiveTab("none");
      setChatMessages([]);
      setChatInput("");
    }
  }, [showAiModal]);

  // Scroll to bottom of chat history when new messages arrive
  useEffect(() => {
    if (aiActiveTab === "chat") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, aiAction, aiActiveTab]);

  async function handleAiSummarize() {
    setAiAction("summarizing");
    setAiSummary(null);
    setAiFlashcards(null);
    setAiError(null);

    const text = readerPaneRef.current?.getActivePageText();
    if (!text || text.trim().length < 10) {
      setAiError("This page does not contain enough readable text to summarize.");
      setAiAction("idle");
      return;
    }

    try {
      const res = await fetch("/api/ai/page-helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "summarize", text }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAiError(data.error || "Failed to generate summary.");
      } else {
        setAiSummary(data.summary || []);
      }
    } catch (err: any) {
      setAiError(err.message || "An error occurred while connecting to the AI helper.");
    } finally {
      setAiAction("idle");
    }
  }

  async function handleAiFlashcards() {
    setAiAction("generating_flashcards");
    setAiSummary(null);
    setAiFlashcards(null);
    setAiError(null);
    setCurrentCardIndex(0);
    setCardFlipped(false);

    const text = readerPaneRef.current?.getActivePageText();
    if (!text || text.trim().length < 10) {
      setAiError("This page does not contain enough readable text to generate flashcards.");
      setAiAction("idle");
      return;
    }

    try {
      const res = await fetch("/api/ai/page-helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "flashcards", text }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAiError(data.error || "Failed to generate flashcards.");
      } else {
        setAiFlashcards(data.flashcards || []);
      }
    } catch (err: any) {
      setAiError(err.message || "An error occurred while connecting to the AI helper.");
    } finally {
      setAiAction("idle");
    }
  }

  async function handleSendChatMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!chatInput.trim() || aiAction !== "idle") return;

    const userQuestion = chatInput.trim();
    setChatInput("");
    setAiError(null);

    const updatedMessages = [
      ...chatMessages,
      { role: "user" as const, content: userQuestion },
    ];
    setChatMessages(updatedMessages);
    setAiAction("chat_answering");

    const text = readerPaneRef.current?.getActivePageText();
    if (!text || text.trim().length < 10) {
      setAiError("This page does not contain enough readable text to ask questions.");
      setAiAction("idle");
      return;
    }

    try {
      const res = await fetch("/api/ai/page-helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ask_book",
          text,
          messages: updatedMessages.slice(1),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAiError(data.error || "Failed to retrieve response from AI.");
      } else {
        setChatMessages([
          ...updatedMessages,
          { role: "assistant" as const, content: data.answer },
        ]);
      }
    } catch (err: any) {
      setAiError(err.message || "An error occurred while connecting to the AI helper.");
    } finally {
      setAiAction("idle");
    }
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

      const { data: bookmarkRows } = await supabase
        .from("bookmarks")
        .select("*")
        .eq("book_id", bookId);

      setBook(bookRow);
      setChapters(parsed.chapters);
      setHighlights(highlightRows ?? []);
      setBookmarks(bookmarkRows ?? []);
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
      const prevChapter = chapters[currentSpineIndex - 1];
      const lastSentenceIndex = prevChapter.sentences.length > 0
        ? prevChapter.sentences.length - 1
        : 0;
      navigateToChapter(currentSpineIndex - 1, lastSentenceIndex);
    }
  }

  function handlePageChange(page: number, pageCount: number) {
    setPageInfo({ page, pageCount });

    const pane = readerPaneRef.current;
    if (pane) {
      const sentenceIndex = pane.getFirstSentenceOnPage();

      if (!ttsController.isPlaying) {
        setCurrentSentenceIndex(sentenceIndex);
      }

      updateProgress({
        spineIndex: currentSpineIndex,
        sentenceIndex,
        scrollOrPageOffset: page,
      });
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

  async function toggleBookmark() {
    if (!book) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const pageIndex = pageInfo.page;
    const existing = bookmarks.find(
      (b) => b.spine_index === currentSpineIndex && b.scroll_or_page_offset === pageIndex
    );

    if (existing) {
      const { error } = await supabase.from("bookmarks").delete().eq("id", existing.id);
      if (!error) {
        setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));
      }
    } else {
      const sentenceIndex = readerPaneRef.current?.getFirstSentenceOnPage() ?? currentSentenceIndex ?? 0;
      const chapter = chapters[currentSpineIndex];
      const pageLabel = `${chapter.title || `Chapter ${currentSpineIndex + 1}`} - Page ${pageIndex + 1} of ${pageInfo.pageCount}`;

      const { data, error } = await supabase
        .from("bookmarks")
        .insert({
          user_id: user.id,
          book_id: book.id,
          spine_index: currentSpineIndex,
          sentence_index: sentenceIndex,
          scroll_or_page_offset: pageIndex,
          page_info: pageLabel,
        })
        .select()
        .single();

      if (!error && data) {
        setBookmarks((prev) => [...prev, data]);
      }
    }
  }

  const chapterWordCounts = useMemo(() => chapters.map((c) => chapterWordCount(c)), [chapters]);

  const summary = useMemo(() => {
    if (!chapters.length) return null;
    const chapterWordCountVal = chapterWordCounts[currentSpineIndex] ?? 0;
    const fraction = pageInfo.pageCount > 0 ? pageInfo.page / pageInfo.pageCount : 0;
    const wordsIntoChapter = chapterWordCountVal * fraction;
    return computeProgressSummary(chapterWordCounts, currentSpineIndex, wordsIntoChapter);
  }, [chapters, chapterWordCounts, currentSpineIndex, pageInfo.page, pageInfo.pageCount]);

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
      {activeTooltip && (
        <div className={styles.tooltipToast}>
          {activeTooltip}
        </div>
      )}
      {!focusMode && (
        <div className={styles.topBar}>
          <Link
            href="/library"
            className={styles.backLink}
            onTouchStart={() => handleTouchStart("Library")}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            ‹ <span className={styles.desktopText}>Library</span>
          </Link>
          <div className={styles.bookTitle}>{book.title}</div>
          <div className={styles.topActions}>
            <button
              onClick={() => setShowSearch(true)}
              aria-label="Search"
              title="Search"
              onTouchStart={() => handleTouchStart("Search")}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <span className={styles.desktopText}>Search</span>
              <span className={styles.mobileIcon}>🔍</span>
            </button>
            <Link
              href={`/book/${book.id}/highlights`}
              aria-label="Highlights"
              title="Highlights"
              onTouchStart={() => handleTouchStart("Highlights")}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <span className={styles.desktopText}>Highlights</span>
              <HighlightIcon className={styles.mobileIcon} />
            </Link>
            <button
              onClick={toggleBookmark}
              className={isCurrentPageBookmarked ? styles.bookmarkActive : ""}
              aria-label={isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark current page"}
              title={isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark current page"}
              onTouchStart={() => handleTouchStart(isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark page")}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              {isCurrentPageBookmarked ? "★" : "☆"}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              aria-label="Settings"
              title="Settings"
              onTouchStart={() => handleTouchStart("Settings")}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              Aa
            </button>
            <button
              onClick={toggleFullscreen}
              aria-label="Toggle fullscreen"
              title="Toggle fullscreen"
              onTouchStart={() => handleTouchStart(isFullscreen ? "Exit fullscreen" : "Enter fullscreen")}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              {isFullscreen ? "⤡" : "⛶"}
            </button>
            <button
              onClick={() => setFocusMode(true)}
              aria-label="Focus mode"
              title="Focus mode: hide sidebar and controls"
              onTouchStart={() => handleTouchStart("Focus mode")}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <span className={styles.desktopText}>Focus</span>
              <span className={styles.mobileIcon}>👁</span>
            </button>
            <button
              onClick={() => setShowInfoModal(true)}
              aria-label="App features guide"
              title="App features guide"
              onTouchStart={() => handleTouchStart("App guide")}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              ℹ
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
                onPageChange={handlePageChange}
                onSentenceClick={handleSentenceClick}
                onSelectionCommit={setPendingSelection}
                onPrevPage={handlePrevPage}
                onNextPage={handleNextPage}
                onWordLookup={(word) => {
                  window.getSelection()?.removeAllRanges();
                  setLookupWord(word);
                }}
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

      {lookupWord && (
        <DictionaryPopover
          word={lookupWord}
          onClose={() => setLookupWord(null)}
        />
      )}

      {!focusMode && (
        <button
          className={styles.aiButton}
          onClick={() => setShowAiModal(true)}
          aria-label="AI assistant"
          title="AI assistant"
        >
          ✨
        </button>
      )}

      {showAiModal && (
        <div
          className={styles.aiWindowOverlay}
          onClick={() => {
            if (aiAction === "idle") setShowAiModal(false);
          }}
        >
          <div className={styles.aiWindow} onClick={(e) => e.stopPropagation()}>
            <div className={styles.aiTitleRow}>
              <h2 className={styles.aiTitle}>
                <span>✨</span> Colophon AI Helper
              </h2>
              <button
                className={styles.aiClose}
                onClick={() => setShowAiModal(false)}
                disabled={aiAction !== "idle"}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className={styles.aiDescription}>
              Analyze this page to extract insights or test your knowledge.
            </p>

            <div className={styles.aiActions}>
              <button
                className={`${styles.aiActionButton} ${aiActiveTab === "summary" ? styles.aiActionButtonActive : ""}`}
                onClick={() => {
                  setAiActiveTab("summary");
                  handleAiSummarize();
                }}
                disabled={aiAction !== "idle" && aiAction !== "chat_answering"}
              >
                <span className={styles.aiActionButtonIcon}>📝</span>
                <span>Summarize Page</span>
              </button>
              <button
                className={`${styles.aiActionButton} ${aiActiveTab === "flashcards" ? styles.aiActionButtonActive : ""}`}
                onClick={() => {
                  setAiActiveTab("flashcards");
                  handleAiFlashcards();
                }}
                disabled={aiAction !== "idle" && aiAction !== "chat_answering"}
              >
                <span className={styles.aiActionButtonIcon}>🃏</span>
                <span>Generate Cards</span>
              </button>
              <button
                className={`${styles.aiActionButton} ${aiActiveTab === "chat" ? styles.aiActionButtonActive : ""}`}
                onClick={() => {
                  setAiActiveTab("chat");
                  if (chatMessages.length === 0) {
                    setChatMessages([
                      { role: "assistant", content: "Hi! I'm your AI reading assistant. Ask me anything about the content of this page!" }
                    ]);
                  }
                }}
                disabled={aiAction !== "idle" && aiAction !== "chat_answering"}
              >
                <span className={styles.aiActionButtonIcon}>💬</span>
                <span>Ask the Book</span>
              </button>
            </div>

            {/* Results Container */}
            <div className={aiActiveTab === "chat" ? styles.chatContainer : styles.aiResultsScroll}>
              {/* Loading View */}
              {aiAction !== "idle" && aiAction !== "chat_answering" && (
                <div className={styles.aiLoading}>
                  <div className={styles.aiSpinner} />
                  <span className={styles.aiLoadingText}>
                    {aiAction === "summarizing"
                      ? "AI is reading page and drafting summary..."
                      : "AI is analyzing context to design flashcards..."}
                  </span>
                </div>
              )}

              {/* Error View */}
              {aiError && <div className={styles.aiError}>⚠️ {aiError}</div>}

              {/* Summary Result */}
              {aiActiveTab === "summary" && aiSummary && aiAction === "idle" && (
                <div className={styles.summaryCard}>
                  <h3 className={styles.summaryTitle}>📝 Page Summary</h3>
                  <ul className={styles.summaryList}>
                    {aiSummary.map((point, index) => (
                      <li key={index} className={styles.summaryItem}>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Flashcards Result */}
              {aiActiveTab === "flashcards" && aiFlashcards && aiFlashcards.length > 0 && aiAction === "idle" && (
                <div className={styles.flashcardArea}>
                  <div
                    className={styles.flashcardPerspective}
                    onClick={() => setCardFlipped(!cardFlipped)}
                  >
                    <div className={`${styles.flashcardInner} ${cardFlipped ? styles.flashcardFlipped : ""}`}>
                      {/* Front: Question */}
                      <div className={styles.flashcardFront}>
                        <span className={styles.flashcardSideLabel}>Question</span>
                        <p className={styles.flashcardContent}>
                          {aiFlashcards[currentCardIndex]?.question}
                        </p>
                        <span className={styles.flashcardInstruction}>Tap to flip & see answer</span>
                      </div>
                      {/* Back: Answer */}
                      <div className={styles.flashcardBack}>
                        <span className={styles.flashcardSideLabel}>Answer</span>
                        <p className={styles.flashcardContent}>
                          {aiFlashcards[currentCardIndex]?.answer}
                        </p>
                        <span className={styles.flashcardInstruction}>Tap to flip back</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.flashcardControls}>
                    <button
                      className={styles.flashcardNavButton}
                      disabled={currentCardIndex === 0}
                      onClick={() => {
                        setCardFlipped(false);
                        setTimeout(() => setCurrentCardIndex((prev) => prev - 1), 150);
                      }}
                    >
                      ◀ Prev
                    </button>
                    <span className={styles.flashcardCounter}>
                      Card {currentCardIndex + 1} of {aiFlashcards.length}
                    </span>
                    <button
                      className={styles.flashcardNavButton}
                      disabled={currentCardIndex === aiFlashcards.length - 1}
                      onClick={() => {
                        setCardFlipped(false);
                        setTimeout(() => setCurrentCardIndex((prev) => prev + 1), 150);
                      }}
                    >
                      Next ▶
                    </button>
                  </div>
                </div>
              )}

              {/* Chat View */}
              {aiActiveTab === "chat" && (
                <>
                  <div className={styles.chatHistory}>
                    {chatMessages.map((msg, index) => (
                      <div
                        key={index}
                        className={`${styles.chatBubble} ${
                          msg.role === "user" ? styles.chatBubbleUser : styles.chatBubbleAssistant
                        }`}
                      >
                        {msg.content}
                      </div>
                    ))}
                    {aiAction === "chat_answering" && (
                      <div className={`${styles.chatBubble} ${styles.chatBubbleAssistant} ${styles.chatBubbleLoading}`}>
                        <div className={styles.chatSpinnerSmall} />
                        <span>AI is reading page & typing...</span>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <form onSubmit={handleSendChatMessage} className={styles.chatInputForm}>
                    <input
                      type="text"
                      className={styles.chatInput}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask about this page..."
                      disabled={aiAction !== "idle" && aiAction !== "chat_answering"}
                    />
                    <button
                      type="submit"
                      className={styles.chatSendButton}
                      disabled={(aiAction !== "idle" && aiAction !== "chat_answering") || !chatInput.trim()}
                    >
                      Send
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showInfoModal && (
        <div className={styles.infoOverlay} onClick={() => setShowInfoModal(false)}>
          <div className={styles.infoCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.infoTitleRow}>
              <h2 className={styles.infoTitle}>
                <span>ℹ️</span> Colophon Guide
              </h2>
              <button
                className={styles.infoClose}
                onClick={() => setShowInfoModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className={styles.infoDescription}>
              Explore the advanced reading and study tools built directly into Colophon.
            </p>

            <div className={styles.featuresList}>
              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>✨</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>AI Helper (Summaries & Cards)</h4>
                  <p className={styles.featureText}>Click the floating button (✨) to query smart key-point summaries or practice active recall with flippable 3D study flashcards.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🗣️</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Premium Read-Aloud</h4>
                  <p className={styles.featureText}>Listen to chapters with natural premium Azure voices. Custom rates, pitches, and active word highlights are supported.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>⏱️</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Control Bar & Sleep Timer</h4>
                  <p className={styles.featureText}>Play, pause, skip chapters, configure voices, or schedule a sleep timer (15 to 60 minutes) at the bottom.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🔍</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Instant Definitions</h4>
                  <p className={styles.featureText}>Press and hold on any word to pull up detailed definitions from Wiktionary and speak pronunciation audios.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🎨</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Tape Highlights</h4>
                  <p className={styles.featureText}>Drag and select page text to mark key items using a custom sticky tape roll marker. Saved items persist dynamically.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🔖</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Bookmarked Pages</h4>
                  <p className={styles.featureText}>Bookmark your current reading locations, and manage/jump back to them easily from the sidebar Bookmarks tab.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>📱</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Standalone Mobile App (PWA)</h4>
                  <p className={styles.featureText}>Install Colophon directly on your home screen for full standalone launch, distraction-free reading, and fast loading.</p>
                </div>
              </div>
            </div>

            <button className={styles.infoCloseBtn} onClick={() => setShowInfoModal(false)}>
              Got it, let's read!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
