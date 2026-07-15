"use client";

import { useState } from "react";
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

export function BookUploadModal({ onClose, onUploaded, mode = "private" }: BookUploadModalProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Queue tracking states
  const [totalFiles, setTotalFiles] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [currentFileName, setCurrentFileName] = useState("");
  const [failedFiles, setFailedFiles] = useState<{ name: string; reason: string }[]>([]);

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
      } catch (e: any) {
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

  return (
    <div className={styles.overlay} onClick={busy ? undefined : onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>{mode === "open" ? "Upload to Open Library" : "Add a book"}</h2>
        <p className={styles.hint}>Choose one or more .epub files from your device.</p>

        {error && <div className={styles.error}>{error}</div>}

        <input
          type="file"
          accept=".epub,application/epub+zip"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) handleFiles(files);
          }}
          disabled={busy}
        />

        {status === "parsing" && (
          <p className={styles.status}>
            [{currentFileIndex}/{totalFiles}] Parsing: <strong>{currentFileName}</strong>…
          </p>
        )}
        {status === "uploading" && (
          <p className={styles.status}>
            [{currentFileIndex}/{totalFiles}] Uploading: <strong>{currentFileName}</strong>…
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
