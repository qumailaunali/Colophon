"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { buildHighlightsMarkdown, downloadTextFile } from "@/lib/export/highlightsExport";
import type { BookRow, HighlightRow } from "@/lib/supabase/types";
import styles from "./page.module.css";

export default function BookHighlightsPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = params.bookId;

  const [book, setBook] = useState<BookRow | null>(null);
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: bookRow }, { data: highlightRows }] = await Promise.all([
      supabase.from("books").select("*").eq("id", bookId).single(),
      supabase
        .from("highlights")
        .select("*")
        .eq("book_id", bookId)
        .order("spine_index", { ascending: true })
        .order("sentence_index_start", { ascending: true }),
    ]);
    setBook(bookRow ?? null);
    setHighlights(highlightRows ?? []);
    setLoading(false);
  }, [bookId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDelete(highlightId: string) {
    const supabase = createClient();
    await supabase.from("highlights").delete().eq("id", highlightId);
    setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
  }

  function handleExport() {
    if (!book) return;
    const markdown = buildHighlightsMarkdown(book.title, highlights);
    downloadTextFile(`${book.title.replace(/[^\w\- ]/g, "")}-highlights.md`, markdown);
  }

  if (loading) return <div className={styles.empty}>Loading highlights…</div>;

  return (
    <div className={styles.page}>
      <Link href={`/book/${bookId}`} className={styles.backLink}>
        ‹ Back to book
      </Link>

      <div className={styles.header}>
        <h1>{book?.title ?? "Highlights"}</h1>
        {highlights.length > 0 && (
          <button className={styles.exportButton} onClick={handleExport}>
            Export as Markdown
          </button>
        )}
      </div>

      {highlights.length === 0 ? (
        <div className={styles.empty}>
          No highlights yet. Select text while reading to create one.
        </div>
      ) : (
        <div className={styles.list}>
          {highlights.map((h) => (
            <div
              key={h.id}
              className={styles.card}
              style={{ ["--swatch" as string]: h.color }}
            >
              <div className={styles.chapterLabel}>Chapter {h.spine_index + 1}</div>
              <div className={styles.snippet}>&ldquo;{h.text_snippet}&rdquo;</div>
              {h.note && <div className={styles.note}>{h.note}</div>}
              <div className={styles.cardActions}>
                <Link href={`/book/${bookId}?spine=${h.spine_index}&sentence=${h.sentence_index_start}`}>
                  Jump to page
                </Link>
                <button onClick={() => handleDelete(h.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
