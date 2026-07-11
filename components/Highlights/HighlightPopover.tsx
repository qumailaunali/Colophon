"use client";

import { useState } from "react";
import styles from "./HighlightPopover.module.css";

const COLORS = ["#C9A227", "#8C2F39", "#1F3554", "#3E7C4A"];

interface HighlightPopoverProps {
  snippet: string;
  onSave: (color: string, note: string) => void;
  onCancel: () => void;
}

export function HighlightPopover({ snippet, onSave, onCancel }: HighlightPopoverProps) {
  const [color, setColor] = useState(COLORS[0]);
  const [note, setNote] = useState("");

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.popover} onClick={(e) => e.stopPropagation()}>
        <p className={styles.snippet}>&ldquo;{snippet}&rdquo;</p>
        <div className={styles.colors}>
          {COLORS.map((c) => (
            <button
              key={c}
              className={styles.swatch}
              style={{ background: c, outline: c === color ? "2px solid var(--color-ink)" : "none" }}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <textarea
          className={styles.note}
          placeholder="Add a note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.save} onClick={() => onSave(color, note)}>
            Save highlight
          </button>
        </div>
      </div>
    </div>
  );
}
