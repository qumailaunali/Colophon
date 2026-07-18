"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ReaderTheme, TtsProviderKind } from "@/lib/supabase/types";
import { useDebouncedCallback } from "./useDebouncedCallback";

export interface ReaderSettingsState {
  fontFamily: string;
  fontSize: number;
  lineSpacing: number;
  theme: ReaderTheme;
  voiceName: string | null;
  speechRate: number;
  speechPitch: number;
  speechVolume: number;
  ttsProvider: TtsProviderKind;
}

export const DEFAULT_READER_SETTINGS: ReaderSettingsState = {
  fontFamily: "Literata",
  fontSize: 18,
  lineSpacing: 1.6,
  theme: "paper",
  voiceName: "en-US-AvaNeural",
  speechRate: 1.0,
  speechPitch: 1.0,
  speechVolume: 1.0,
  ttsProvider: "edge",
};

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettingsState>(DEFAULT_READER_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("reader_settings").select("*").maybeSingle();
      if (cancelled) return;
      if (data) {
        setSettings({
          fontFamily: data.font_family,
          fontSize: data.font_size,
          lineSpacing: Number(data.line_spacing),
          theme: data.theme,
          voiceName: data.voice_name,
          speechRate: Number(data.speech_rate),
          speechPitch: Number(data.speech_pitch),
          speechVolume: Number(data.speech_volume),
          ttsProvider: data.tts_provider,
        });
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Named function expression so the retry-with-backoff self-call binds to
  // this function's own local name rather than the (still-initializing)
  // outer `persist` const.
  const persist = useCallback(
    async function persistImpl(next: ReaderSettingsState, attempt = 0): Promise<void> {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;

      const { error } = await supabase.from("reader_settings").upsert(
        {
          user_id: userId,
          font_family: next.fontFamily,
          font_size: next.fontSize,
          line_spacing: next.lineSpacing,
          theme: next.theme,
          voice_name: next.voiceName,
          speech_rate: next.speechRate,
          speech_pitch: next.speechPitch,
          speech_volume: next.speechVolume,
          tts_provider: next.ttsProvider,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (error && attempt < 3) {
        setTimeout(() => persistImpl(next, attempt + 1), 1500 * (attempt + 1));
      }
    },
    [supabase]
  );

  const debouncedPersist = useDebouncedCallback(persist, 2500);

  const updateSettings = useCallback(
    (patch: Partial<ReaderSettingsState>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        debouncedPersist(next);
        return next;
      });
    },
    [debouncedPersist]
  );

  return { settings, loaded, updateSettings };
}
