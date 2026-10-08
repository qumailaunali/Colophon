"use client";

import { useRef, useState, type DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseEpub } from "@/lib/epub/parser";
import { computeChapterWordCounts } from "@/lib/reading/progressMath";
import styles from "./BookUploadModal.module.css";

interface BookUploadModalProps {
  onClose: () => void;
  onUploaded: () => void;
  mode?: "private" | "open";
}

type Status = "idle" | "parsing" | "uploading" | "error";

function isEpub(file: File) {
  return file.name.toLowerCase().endsWith(".epub") || file.type === "application/epub+zip";
}

export function BookUploadModal({ onClose, onUploaded, mode = "private" }: BookUploadModalProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Queue tracking states
  const [totalFiles, setTotalFiles] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [currentFileName, setCurrentFileName] = useState("");
  const [failedFiles, setFailedFiles] = useState<{ name: string; reason: string }[]>([]);
  const [skippedFiles, setSkippedFiles] = useState<string[]>([]);

  // Drag-and-drop: enter/leave also fire for child elements, so count them.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  function acceptFiles(list: FileList | null) {
    const all = Array.from(list ?? []);
    const epubs = all.filter(isEpub);
    setSkippedFiles(all.filter((f) => !isEpub(f)).map((f) => f.name));
    if (epubs.length > 0) handleFiles(epubs);
  }

  async function handleFiles(files: File[]) {
    setError(null);
    setFailedFiles([]);
    setTotalFiles(files.length);
    setCurrentFileIndex(0);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not signed in");
      return;
    }

    const failedList: { name: string; reason: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setCurrentFileIndex(i + 1);
      setCurrentFileName(file.name);

      try {
        setStatus("parsing");
        const parsed = await parseEpub(file);

        setStatus("uploading");
        const bookId = crypto.randomUUID();
        const isPublicOpen = mode === "open";
        const filePath = isPublicOpen
          ? `open_library/${bookId}/book.epub`
          : `${user.id}/${bookId}/book.epub`;

        const { error: uploadErr } = await supabase.storage
          .from("library")
          .upload(filePath, file, { contentType: "application/epub+zip", upsert: true });
        if (uploadErr) throw uploadErr;

        let coverPath: string | null = null;
        if (parsed.coverBlob) {
          const ext = parsed.coverMediaType?.includes("png") ? "png" : "jpg";
          coverPath = isPublicOpen
            ? `open_library/${bookId}/cover.${ext}`
            : `${user.id}/${bookId}/cover.${ext}`;

          const { error: coverErr } = await supabase.storage
            .from("library")
            .upload(coverPath, parsed.coverBlob, {
              contentType: parsed.coverMediaType ?? "image/jpeg",
              upsert: true,
            });
          if (coverErr) throw coverErr;
        }

        const chapterWordCounts = computeChapterWordCounts(parsed.chapters);
        const chapterSentenceCounts = parsed.chapters.map((c) => c.sentences.length);

        if (isPublicOpen) {
          const { error: insertErr } = await supabase.from("open_library_books").insert({
            id: bookId,
            title: parsed.title,
            author: parsed.author,
            cover_path: coverPath,
            file_path: filePath,
            toc: { entries: parsed.toc, chapterWordCounts, chapterSentenceCounts },
            uploader_email: user.email ?? null,
          });
          if (insertErr) throw insertErr;
        } else {
          const { error: insertErr } = await supabase.from("books").insert({
            id: bookId,
            user_id: user.id,
            title: parsed.title,
            author: parsed.author,
            cover_path: coverPath,
            file_path: filePath,
            toc: { entries: parsed.toc, chapterWordCounts, chapterSentenceCounts },
          });
          if (insertErr) throw insertErr;
        }
      } catch (e: unknown) {
        console.error(`Error uploading "${file.name}":`, e);
        failedList.push({
          name: file.name,
          reason: e instanceof Error ? e.message : "Upload failed"
        });
      }
    }

    // Done with batch
    setStatus("idle");
    onUploaded();

    if (failedList.length > 0) {
      setFailedFiles(failedList);
      setStatus("error");
      setError(`Uploaded ${files.length - failedList.length} of ${files.length} books successfully.`);
    } else {
      onClose();
    }
  }

  const busy = status === "parsing" || status === "uploading";

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    if (busy) return;
    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (!busy) acceptFiles(e.dataTransfer.files);
  }

  // The whole overlay swallows drags so a slightly-missed drop doesn't make
  // the browser navigate away to open the file.
  const preventDefault = (e: DragEvent) => e.preventDefault();

  // Each book counts as half done once parsed, fully done once uploaded.
  const progress =
    totalFiles > 0
      ? ((currentFileIndex - (status === "parsing" ? 1 : 0.5)) / totalFiles) * 100
      : 0;

  return (
    <div
      className={styles.overlay}
      onClick={busy ? undefined : onClose}
      onDragOver={preventDefault}
      onDrop={preventDefault}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>{mode === "open" ? "Upload to Open Library" : "Add a book"}</h2>
        <p className={styles.hint}>Add one or more .epub files from your device.</p>

        {error && <div className={styles.error}>{error}</div>}

        <label
          className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ""} ${
            busy ? styles.dropZoneBusy : ""
          }`}
          onDragEnter={handleDragEnter}
          onDragOver={preventDefault}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            className={styles.fileInput}
            accept=".epub,application/epub+zip"
            multiple
            disabled={busy}
            onChange={(e) => {
              acceptFiles(e.target.files);
              // Allow picking the same file again after a failure.
              e.target.value = "";
            }}
          />

          {busy ? (
            <div className={styles.progressBlock} aria-live="polite">
              <span className={styles.spinner} aria-hidden />
              <p className={styles.progressLabel}>
                {status === "parsing" ? "Reading" : "Uploading"} book {currentFileIndex} of {totalFiles}
              </p>
              <p className={styles.progressFile} title={currentFileName}>
                {currentFileName}
              </p>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <>
              <svg
                className={styles.dropIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                <path d="M12 13V7" />
                <path d="m9.5 9.5 2.5-2.5 2.5 2.5" />
              </svg>
              <p className={styles.dropTitle}>
                {isDragging ? (
                  "Drop to add your books"
                ) : (
                  <>
                    <span className={styles.pointerText}>Drag &amp; drop your EPUB files here</span>
                    <span className={styles.touchText}>Tap to choose EPUB files</span>
                  </>
                )}
              </p>
              {!isDragging && (
                <>
                  <span className={`${styles.dropOr} ${styles.pointerText}`}>or</span>
                  <span className={styles.chooseButton}>Choose files</span>
                  <span className={styles.dropMeta}>.epub · multiple files supported</span>
                </>
              )}
            </>
          )}
        </label>

        {skippedFiles.length > 0 && !busy && (
          <p className={styles.skipped}>
            Skipped {skippedFiles.length === 1 ? "1 file" : `${skippedFiles.length} files`} that{" "}
            {skippedFiles.length === 1 ? "isn't" : "aren't"} EPUB: {skippedFiles.join(", ")}
          </p>
        )}

        {failedFiles.length > 0 && (
          <div className={styles.failedList}>
            <p className={styles.failedHeader}>⚠️ Some uploads failed:</p>
            <ul>
              {failedFiles.map((f, idx) => (
                <li key={idx} className={styles.failedItem}>
                  <strong>{f.name}</strong>: {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
