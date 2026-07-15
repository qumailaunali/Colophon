"use client";

import { useEffect, useState } from "react";
import styles from "./DictionaryPopover.module.css";

interface DictionaryPopoverProps {
  word: string;
  onClose: () => void;
}

interface Definition {
  definition: string;
  example?: string;
}

interface Meaning {
  partOfSpeech: string;
  definitions: Definition[];
}

interface Phonetic {
  text?: string;
  audio?: string;
}

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  phonetics: Phonetic[];
  meanings: Meaning[];
}

export function DictionaryPopover({ word, onClose }: DictionaryPopoverProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    // Clean word from punctuation and keep letters, apostrophes, and hyphens
    const cleanWord = word.replace(/[^a-zA-Z'-]/g, "").trim().toLowerCase();

    if (!cleanWord) {
      setError("Invalid word selection.");
      setLoading(false);
      return;
    }

    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${cleanWord}`)
      .then((res) => {
        if (!res.ok) throw new Error("Word not found in dictionary.");
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data) && data.length > 0) {
          setEntry(data[0]);
        } else {
          throw new Error("No definition available.");
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || "Failed to fetch definition.");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [word]);

  const playPronunciation = () => {
    if (!entry) return;
    const phoneticWithAudio = entry.phonetics.find((p) => p.audio);
    if (phoneticWithAudio?.audio) {
      const audio = new Audio(phoneticWithAudio.audio);
      audio.play().catch(() => {});
    }
  };

  const hasAudio = entry?.phonetics.some((p) => p.audio);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.popover} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
          ✕
        </button>

        {loading && <div className={styles.loading}>Looking up definition…</div>}

        {error && (
          <div className={styles.errorState}>
            <h3>No Definition Found</h3>
            <p className={styles.wordLabel}>&ldquo;{word}&rdquo;</p>
            <p className={styles.errorMsg}>{error}</p>
          </div>
        )}

        {!loading && !error && entry && (
          <div className={styles.content}>
            <div className={styles.header}>
              <h2 className={styles.word}>{entry.word}</h2>
              {hasAudio && (
                <button
                  className={styles.audioBtn}
                  onClick={playPronunciation}
                  title="Listen to pronunciation"
                  aria-label="Play pronunciation"
                >
                  🔊
                </button>
              )}
            </div>

            {entry.phonetic && <p className={styles.phonetic}>{entry.phonetic}</p>}

            <div className={styles.meaningsList}>
              {entry.meanings.slice(0, 3).map((meaning, idx) => (
                <div key={idx} className={styles.meaning}>
                  <span className={styles.partOfSpeech}>{meaning.partOfSpeech}</span>
                  <ol className={styles.definitions}>
                    {meaning.definitions.slice(0, 2).map((def, dIdx) => (
                      <li key={dIdx} className={styles.definitionItem}>
                        <p className={styles.definitionText}>{def.definition}</p>
                        {def.example && (
                          <p className={styles.exampleText}>
                            Example: &ldquo;{def.example}&rdquo;
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
