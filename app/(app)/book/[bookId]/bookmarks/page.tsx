"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { BookRow, BookmarkRow } from "@/lib/supabase/types";
import styles from "./page.module.css";

export default function BookBookmarksPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [book, setBook] = useState<BookRow | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: bookRow }, { data: bookmarkRows }] = await Promise.all([
      supabase.from("books").select("*").eq("id", bookId).single(),
      supabase
        .from("bookmarks")
        .select("*")
        .eq("book_id", bookId)
        .order("spine_index", { ascending: true })
        .order("scroll_or_page_offset", { ascending: true }),
    ]);
    setBook(bookRow ?? null);
    setBookmarks(bookmarkRows ?? []);
    setLoading(false);
  }, [bookId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDelete(bookmarkId: string) {
    const supabase = createClient();
    await supabase.from("bookmarks").delete().eq("id", bookmarkId);
    setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
  }

  if (loading) return <div className={styles.empty}>Loading bookmarks…</div>;

  return (
    <div className={styles.page}>
      <Link href={`/book/${bookId}`} className={styles.backLink}>
        ‹ Back to book
      </Link>

      <div className={styles.header}>
        <h1>{book?.title ?? "Bookmarks"}</h1>
      </div>

      {bookmarks.length === 0 ? (
        <div className={styles.empty}>
          No bookmarks yet. Click the bookmark button while reading to save the current page.
        </div>
      ) : (
        <div className={styles.list}>
          {bookmarks.map((b) => (
            <div
              key={b.id}
              className={styles.card}
            >
              <div className={styles.cardContent}>
                <div className={styles.pageLabel}>{b.page_info}</div>
                <div className={styles.dateLabel}>
                  Saved on:{" "}
                  {new Date(b.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <div className={styles.cardActions}>
                <Link href={`/book/${bookId}?spine=${b.spine_index}&sentence=${b.sentence_index}`}>
                  Jump to page
                </Link>
                <button onClick={() => handleDelete(b.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
