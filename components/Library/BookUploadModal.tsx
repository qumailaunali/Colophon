"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseEpub } from "@/lib/epub/parser";
import { computeChapterWordCounts } from "@/lib/reading/progressMath";
import styles from "./BookUploadModal.module.css";

interface BookUploadModalProps {
  onClose: () => void;
  onUploaded: () => void;
}

type Status = "idle" | "parsing" | "uploading" | "error";

export function BookUploadModal({ onClose, onUploaded }: BookUploadModalProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setStatus("parsing");
    try {
      const parsed = await parseEpub(file);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const bookId = crypto.randomUUID();
      setStatus("uploading");

      const filePath = `${user.id}/${bookId}/book.epub`;
      const { error: uploadErr } = await supabase.storage
        .from("library")
        .upload(filePath, file, { contentType: "application/epub+zip", upsert: true });
      if (uploadErr) throw uploadErr;

      let coverPath: string | null = null;
      if (parsed.coverBlob) {
        const ext = parsed.coverMediaType?.includes("png") ? "png" : "jpg";
        coverPath = `${user.id}/${bookId}/cover.${ext}`;
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

      onUploaded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add book");
      setStatus("error");
    }
  }

  const busy = status === "parsing" || status === "uploading";

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>Add a book</h2>
        <p className={styles.hint}>Choose an .epub file from your device.</p>

        {error && <div className={styles.error}>{error}</div>}

        <input
          type="file"
          accept=".epub,application/epub+zip"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          disabled={busy}
        />

        {status === "parsing" && <p className={styles.status}>Parsing EPUB…</p>}
        {status === "uploading" && <p className={styles.status}>Uploading…</p>}

        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
