"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LibraryGrid } from "@/components/Library/LibraryGrid";
import { BookUploadModal } from "@/components/Library/BookUploadModal";
import type { BookRow, ReadingProgressRow } from "@/lib/supabase/types";
import styles from "./page.module.css";

export default function LibraryPage() {
  const [books, setBooks] = useState<BookRow[]>([]);
  const [progressByBook, setProgressByBook] = useState<Record<string, ReadingProgressRow>>({});
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const [{ data: booksData }, { data: progressData }] = await Promise.all([
      supabase.from("books").select("*").order("created_at", { ascending: false }),
      supabase.from("reading_progress").select("*"),
    ]);

    const typedBooks = booksData ?? [];
    setBooks(typedBooks);

    const progressMap: Record<string, ReadingProgressRow> = {};
    (progressData ?? []).forEach((p) => {
      progressMap[p.book_id] = p;
    });
    setProgressByBook(progressMap);

    const coverPaths = typedBooks.map((b) => b.cover_path).filter((p): p is string => !!p);
    if (coverPaths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("library")
        .createSignedUrls(coverPaths, 3600);
      const urlMap: Record<string, string> = {};
      typedBooks.forEach((b) => {
        const entry = signed?.find((s) => s.path === b.cover_path);
        if (entry?.signedUrl) urlMap[b.id] = entry.signedUrl;
      });
      setCoverUrls(urlMap);
    } else {
      setCoverUrls({});
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDelete(bookId: string) {
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    if (
      !window.confirm(
        `Delete "${book.title}"? This removes the file and all its highlights/progress.`
      )
    ) {
      return;
    }

    const supabase = createClient();
    const paths = [book.file_path, book.cover_path].filter((p): p is string => !!p);
    await supabase.storage.from("library").remove(paths);
    await supabase.from("books").delete().eq("id", bookId);
    refresh();
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Library</h1>
        <button className={styles.addButton} onClick={() => setShowUpload(true)}>
          + Add a book
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading your library…</div>
      ) : (
        <LibraryGrid
          books={books}
          progressByBook={progressByBook}
          coverUrls={coverUrls}
          onDelete={handleDelete}
        />
      )}

      {showUpload && <BookUploadModal onClose={() => setShowUpload(false)} onUploaded={refresh} />}
    </div>
  );
}
