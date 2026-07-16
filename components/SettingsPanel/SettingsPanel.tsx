"use client";

import type { ReaderSettingsState } from "@/lib/hooks/useReaderSettings";
import type { ReaderTheme } from "@/lib/supabase/types";
import styles from "./SettingsPanel.module.css";

const FONT_OPTIONS = [
  { value: "Literata", label: "Literata (serif)" },
  { value: "Fraunces", label: "Fraunces (serif)" },
  { value: "Georgia, serif", label: "Georgia (serif)" },
  { value: "system-ui, sans-serif", label: "System sans-serif" },
];

const THEMES: { value: ReaderTheme; label: string; swatch: string }[] = [
  { value: "paper", label: "Paper", swatch: styles.themePaper },
  { value: "sepia", label: "Sepia", swatch: styles.themeSepia },
  { value: "dark", label: "Dark", swatch: styles.themeDark },
];

interface SettingsPanelProps {
  settings: ReaderSettingsState;
  onChange: (patch: Partial<ReaderSettingsState>) => void;
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Reader Fonts</span>
        <button
          type="button"
          className={styles.resetSettingsButton}
          onClick={() =>
            onChange({
              fontFamily: "Literata",
              fontSize: 18,
              lineSpacing: 1.6,
            })
          }
        >
          Reset Fonts
        </button>
      </div>

      <div className={styles.field}>
        <label>Font family</label>
        <select
          className={styles.select}
          value={settings.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label>Font size</label>
        <div className={styles.row}>
          <input
            type="range"
            min={10}
            max={28}
            step={1}
            value={settings.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          />
          <span className={styles.value}>{settings.fontSize}px</span>
        </div>
      </div>

      <div className={styles.field}>
        <label>Line spacing</label>
        <div className={styles.row}>
          <input
            type="range"
            min={1.2}
            max={2.2}
            step={0.05}
            value={settings.lineSpacing}
            onChange={(e) => onChange({ lineSpacing: Number(e.target.value) })}
          />
          <span className={styles.value}>{settings.lineSpacing.toFixed(2)}</span>
        </div>
      </div>

      <div className={styles.field}>
        <label>Theme</label>
        <div className={styles.themeRow}>
          {THEMES.map((t) => (
            <button
              key={t.value}
              className={`${styles.themeSwatch} ${t.swatch} ${
                settings.theme === t.value ? styles.themeSwatchActive : ""
              }`}
              onClick={() => onChange({ theme: t.value })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
