"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getTTSProvider } from "@/lib/tts/getTTSProvider";
import type { TTSProvider, TTSVoice } from "@/lib/tts/TTSProvider";
import type { EpubChapter } from "@/lib/epub/types";
import type { ReaderSettingsState } from "./useReaderSettings";

interface UseTTSControllerArgs {
  settings: ReaderSettingsState;
  onSentenceChange: (spineIndex: number, sentenceIndex: number) => void;
  /** Fired when the last sentence of the current chapter has finished speaking. */
  onChapterEnd: () => void;
}

/** Scene-break markers and stray punctuation ("-", "—", "***", "•••") have
 * nothing worth speaking and some TTS engines reject them outright — only
 * bother calling the provider if there's at least one letter or digit. */
function hasSpeakableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Drives sentence-by-sentence read-aloud against whichever TTSProvider
 * matches settings.ttsProvider (free Web Speech or premium Azure). Pause/
 * stop both cancel the in-flight utterance rather than relying on
 * provider-native pause/resume (flaky cross-browser for Web Speech) —
 * "pause" keeps the sentence cursor where it was so playback picks back up
 * from the same spot (used by the sleep timer too), while "stop"
 * additionally rewinds to the chapter start.
 */
export function useTTSController({ settings, onSentenceChange, onChapterEnd }: UseTTSControllerArgs) {
  const providerRef = useRef<TTSProvider>(getTTSProvider(settings.ttsProvider));
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const chapterRef = useRef<EpubChapter | null>(null);
  const sentenceIndexRef = useRef(0);
  const settingsRef = useRef(settings);
  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  function setPlaying(value: boolean) {
    isPlayingRef.current = value;
    setIsPlaying(value);
  }

  // Swap the active provider whenever the chosen voice engine changes,
  // stopping whatever the previous engine was doing mid-sentence.
  useEffect(() => {
    providerRef.current.stop();
    setPlaying(false);
    setLastError(null);
    providerRef.current = getTTSProvider(settings.ttsProvider);
    providerRef.current.listVoices().then(setVoices);
  }, [settings.ttsProvider]);

  // Named function expression so the recursive self-call below binds to
  // this function's own local name rather than the (still-initializing)
  // outer `speakCurrent` const.
  const speakCurrent = useCallback(function speakCurrentImpl() {
    const chapter = chapterRef.current;
    if (!chapter) return;
    const sentence = chapter.sentences.find((s) => s.index === sentenceIndexRef.current);
    if (!sentence) {
      setPlaying(false);
      onChapterEnd();
      return;
    }

    onSentenceChange(chapter.spineIndex, sentence.index);

    if (!hasSpeakableContent(sentence.text)) {
      sentenceIndexRef.current += 1;
      speakCurrentImpl();
      return;
    }

    providerRef.current.speak(
      sentence.text,
      {
        rate: settingsRef.current.speechRate,
        pitch: settingsRef.current.speechPitch,
        volume: settingsRef.current.speechVolume,
        voiceName: settingsRef.current.voiceName,
      },
      {
        onEnd: () => {
          if (!isPlayingRef.current) return;
          setLastError(null);
          sentenceIndexRef.current += 1;
          speakCurrentImpl();
        },
        onError: (error) => {
          setPlaying(false);
          const message = error instanceof Error ? error.message : String(error);
          console.error("[TTS] speak failed:", error);
          setLastError(message);
        },
      }
    );

    // Prefetch the next speakable sentence if the provider supports it
    if (providerRef.current.prefetch) {
      let nextIndex = sentenceIndexRef.current + 1;
      let nextSentence = chapter.sentences.find((s) => s.index === nextIndex);
      while (nextSentence && !hasSpeakableContent(nextSentence.text)) {
        nextIndex += 1;
        nextSentence = chapter.sentences.find((s) => s.index === nextIndex);
      }
      if (nextSentence) {
        providerRef.current.prefetch(nextSentence.text, {
          rate: settingsRef.current.speechRate,
          pitch: settingsRef.current.speechPitch,
          volume: settingsRef.current.speechVolume,
          voiceName: settingsRef.current.voiceName,
        });
      }
    }
  }, [onChapterEnd, onSentenceChange]);

  const setChapter = useCallback((chapter: EpubChapter, sentenceIndex = 0) => {
    chapterRef.current = chapter;
    sentenceIndexRef.current = sentenceIndex;
  }, []);

  const play = useCallback(
    (chapter?: EpubChapter, sentenceIndex?: number) => {
      if (chapter) chapterRef.current = chapter;
      if (sentenceIndex != null) sentenceIndexRef.current = sentenceIndex;
      if (!chapterRef.current) return;
      setLastError(null);
      setPlaying(true);
      speakCurrent();
    },
    [speakCurrent]
  );

  const pause = useCallback(() => {
    providerRef.current.stop();
    setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    providerRef.current.stop();
    setPlaying(false);
    sentenceIndexRef.current = 0;
    if (chapterRef.current) onSentenceChange(chapterRef.current.spineIndex, 0);
  }, [onSentenceChange]);

  const togglePlayPause = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);

  const clearError = useCallback(() => setLastError(null), []);

  return { isPlaying, voices, lastError, clearError, play, pause, stop, togglePlayPause, setChapter };
}
