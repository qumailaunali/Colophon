"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDebouncedCallback } from "./useDebouncedCallback";

export interface ReadingProgress {
  spineIndex: number;
  sentenceIndex: number;
  scrollOrPageOffset: number;
}

const DEFAULT_PROGRESS: ReadingProgress = {
  spineIndex: 0,
  sentenceIndex: 0,
  scrollOrPageOffset: 0,
};

/**
 * Source of truth for cross-device resume: fetches Supabase on mount, then
 * debounce-saves (~2.5s) on every update so rapid page turns / TTS sentence
 * changes don't spam writes. Failed saves retry with backoff instead of
 * surfacing an error, per the "never crash on a network blip" requirement.
 */
export function useReadingProgress(bookId: string) {
  const [supabase] = useState(() => createClient());
  const [progress, setProgress] = useState<ReadingProgress>(DEFAULT_PROGRESS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => {
      const { data } = await supabase
        .from("reading_progress")
        .select("*")
        .eq("book_id", bookId)
        .maybeSingle();
      if (cancelled) return;
      setProgress(
        data
          ? {
              spineIndex: data.spine_index,
              sentenceIndex: data.sentence_index,
              scrollOrPageOffset: data.scroll_or_page_offset,
            }
          : DEFAULT_PROGRESS
      );
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, supabase]);

  // Named function expression so the retry-with-backoff self-call binds to
  // this function's own local name rather than the (still-initializing)
  // outer `persist` const.
  const persist = useCallback(
    async function persistImpl(next: ReadingProgress, attempt = 0): Promise<void> {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;

      const { error } = await supabase.from("reading_progress").upsert(
        {
          user_id: userId,
          book_id: bookId,
          spine_index: next.spineIndex,
          sentence_index: next.sentenceIndex,
          scroll_or_page_offset: next.scrollOrPageOffset,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,book_id" }
      );

      if (error && attempt < 3) {
        setTimeout(() => persistImpl(next, attempt + 1), 1500 * (attempt + 1));
      }
    },
    [bookId, supabase]
  );

  const debouncedPersist = useDebouncedCallback(persist, 2500);

  const updateProgress = useCallback(
    (next: ReadingProgress) => {
      setProgress(next);
      debouncedPersist(next);
    },
    [debouncedPersist]
  );

  return { progress, loaded, updateProgress };
}
