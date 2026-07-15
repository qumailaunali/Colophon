"use client";

import { useState } from "react";
import type { TTSVoice } from "@/lib/tts/TTSProvider";
import type { TtsProviderKind } from "@/lib/supabase/types";
import styles from "./ControlBar.module.css";

const SLEEP_OPTIONS = [10, 20, 30, 45, 60];

interface ControlBarProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  ttsProvider: TtsProviderKind;
  onTtsProviderChange: (kind: TtsProviderKind) => void;
  voices: TTSVoice[];
  voiceName: string | null;
  onVoiceChange: (name: string) => void;
  speechRate: number;
  onRateChange: (rate: number) => void;
  speechPitch: number;
  onPitchChange: (pitch: number) => void;
  speechVolume: number;
  onVolumeChange: (volume: number) => void;
  sleepMinutesRemaining: number | null;
  onSetSleepTimer: (minutes: number | null) => void;
}

export function ControlBar({
  isPlaying,
  onTogglePlay,
  onStop,
  onPrevChapter,
  onNextChapter,
  ttsProvider,
  onTtsProviderChange,
  voices,
  voiceName,
  onVoiceChange,
  speechRate,
  onRateChange,
  speechPitch,
  onPitchChange,
  speechVolume,
  onVolumeChange,
  sleepMinutesRemaining,
  onSetSleepTimer,
}: ControlBarProps) {
  const [showSpeechSettings, setShowSpeechSettings] = useState(false);

  return (
    <div className={styles.bar}>
      <div className={styles.sleepGroup}>
        <span className={styles.sleepLabel}>Sleep timer</span>
        <select
          className={styles.select}
          value={sleepMinutesRemaining != null ? "on" : "off"}
          onChange={(e) => {
            const value = e.target.value;
            onSetSleepTimer(value === "off" ? null : Number(value));
          }}
        >
          <option value="off">Off</option>
          {SLEEP_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </select>
        {sleepMinutesRemaining != null && <span>{sleepMinutesRemaining} min left</span>}
      </div>

      <div className={styles.centerGroup}>
        <div className={styles.transport}>
          <button className={styles.iconButton} onClick={onPrevChapter} aria-label="Previous chapter">
            ⏮
          </button>
          <button className={styles.iconButton} onClick={onStop} aria-label="Stop">
            ◼
          </button>
          <button className={styles.playButton} onClick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <button className={styles.iconButton} onClick={onNextChapter} aria-label="Next chapter">
            ⏭
          </button>
          <button
            className={styles.iconButton}
            onClick={() => setShowSpeechSettings(true)}
            aria-label="Voice settings"
            title="Voice settings"
          >
            ⚙
          </button>
        </div>
      </div>

      <div />

      {showSpeechSettings && (
        <div className={styles.overlay} onClick={() => setShowSpeechSettings(false)}>
          <div className={styles.popup} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.popupTitle}>Voice settings</h2>

            <label className={styles.popupField}>
              Voice engine
              <select
                className={styles.popupSelect}
                value={ttsProvider}
                onChange={(e) => onTtsProviderChange(e.target.value as TtsProviderKind)}
              >
                <option value="webspeech">Browser voice (free)</option>
                <option value="azure">Azure Neural (premium)</option>
              </select>
            </label>

            <label className={styles.popupField}>
              Voice
              <select
                className={styles.popupSelect}
                value={voiceName ?? ""}
                onChange={(e) => onVoiceChange(e.target.value)}
              >
                <option value="">Default voice</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.popupSlider}>
              Speed {speechRate.toFixed(2)}x
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={speechRate}
                onChange={(e) => onRateChange(Number(e.target.value))}
              />
            </label>
            <label className={styles.popupSlider}>
              Pitch {speechPitch.toFixed(2)}
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={speechPitch}
                onChange={(e) => onPitchChange(Number(e.target.value))}
              />
            </label>
            <label className={styles.popupSlider}>
              Volume {Math.round(speechVolume * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={speechVolume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
              />
            </label>

            <button className={styles.popupClose} onClick={() => setShowSpeechSettings(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
