"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LibraryGrid } from "@/components/Library/LibraryGrid";
import { BookUploadModal } from "@/components/Library/BookUploadModal";
import { ImportBookModal } from "@/components/Library/ImportBookModal";
import type { BookRow, ReadingProgressRow } from "@/lib/supabase/types";
import styles from "./page.module.css";

type Tab = "mine" | "open" | "admin";

export default function LibraryPage() {
  const [books, setBooks] = useState<BookRow[]>([]);
  const [progressByBook, setProgressByBook] = useState<Record<string, ReadingProgressRow>>({});
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);

  // Open Library States
  const [activeTab, setActiveTab] = useState<Tab>("mine");
  const [user, setUser] = useState<any>(null);
  const [openLibraryBooks, setOpenLibraryBooks] = useState<any[]>([]);
  const [allUploadedBooks, setAllUploadedBooks] = useState<any[]>([]);
  const [importingBookId, setImportingBookId] = useState<string | null>(null);
  const [adminProcessingId, setAdminProcessingId] = useState<string | null>(null);
  const [showImportSources, setShowImportSources] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const { data: { user: currentUser } } = await supabase.auth.getUser();
    setUser(currentUser);

    if (!currentUser) {
      setLoading(false);
      return;
    }

    const isAdmin = currentUser.email === "qumailaunali@gmail.com";

    const [{ data: booksData }, { data: progressData }, { data: openLibraryData }] = await Promise.all([
      supabase.from("books").select("*").order("created_at", { ascending: false }),
      supabase.from("reading_progress").select("*"),
      supabase.from("open_library_books").select("*").order("created_at", { ascending: false })
    ]);

    const allBooks = booksData ?? [];
    const openBooks = openLibraryData ?? [];
    const progresses = progressData ?? [];

    // "My books" should be only the books owned by the current user
    const myBooks = allBooks.filter((b) => b.user_id === currentUser.id);
    setBooks(myBooks);
    setOpenLibraryBooks(openBooks);

    if (isAdmin) {
      const isAlreadyInOpenLibrary = (b: any) => {
        return openBooks.some(
          (o: any) =>
            o.title.toLowerCase().trim() === b.title.toLowerCase().trim() &&
            (o.author || "").toLowerCase().trim() === (b.author || "").toLowerCase().trim()
        );
      };
      const candidates = allBooks.filter((b) => !isAlreadyInOpenLibrary(b));
      setAllUploadedBooks(candidates);
    }

    const progressMap: Record<string, ReadingProgressRow> = {};
    progresses.forEach((p) => {
      progressMap[p.book_id] = p;
    });
    setProgressByBook(progressMap);

    // Cover URLs logic
    const myCoverPaths = myBooks.map((b) => b.cover_path).filter((p): p is string => !!p);
    const openCoverPaths = openBooks.map((b) => b.cover_path).filter((p): p is string => !!p);
    const candidateCoverPaths = isAdmin ? allUploadedBooks.map((b) => b.cover_path).filter((p): p is string => !!p) : [];

    const allCoverPaths = Array.from(new Set([...myCoverPaths, ...openCoverPaths, ...candidateCoverPaths]));

    if (allCoverPaths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("library")
        .createSignedUrls(allCoverPaths, 3600);

      const urlMap: Record<string, string> = {};
      
      myBooks.forEach((b) => {
        const entry = signed?.find((s) => s.path === b.cover_path);
        if (entry?.signedUrl) urlMap[b.id] = entry.signedUrl;
      });

      openBooks.forEach((b) => {
        const entry = signed?.find((s) => s.path === b.cover_path);
        if (entry?.signedUrl) urlMap[b.id] = entry.signedUrl;
      });

      if (isAdmin) {
        allUploadedBooks.forEach((b) => {
          const entry = signed?.find((s) => s.path === b.cover_path);
          if (entry?.signedUrl) urlMap[b.id] = entry.signedUrl;
        });
      }

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

  // Import Book Logic
  async function handleImportBook(openBook: any) {
    if (!user) return;
    setImportingBookId(openBook.id);

    try {
      const supabase = createClient();
      const newBookId = crypto.randomUUID();

      // 1. Download file from open_library
      const { data: fileBlob, error: downloadErr } = await supabase.storage
        .from("library")
        .download(openBook.file_path);
      if (downloadErr || !fileBlob) throw new Error("Could not download EPUB file from Open Library.");

      // 2. Upload to user folder
      const newFilePath = `${user.id}/${newBookId}/book.epub`;
      const { error: uploadErr } = await supabase.storage
        .from("library")
        .upload(newFilePath, fileBlob, { contentType: "application/epub+zip", upsert: true });
      if (uploadErr) throw uploadErr;

      // 3. Download and re-upload cover
      let newCoverPath: string | null = null;
      if (openBook.cover_path) {
        const { data: coverBlob, error: coverDownloadErr } = await supabase.storage
          .from("library")
          .download(openBook.cover_path);
        
        if (!coverDownloadErr && coverBlob) {
          const ext = openBook.cover_path.endsWith("png") ? "png" : "jpg";
          newCoverPath = `${user.id}/${newBookId}/cover.${ext}`;
          await supabase.storage
            .from("library")
            .upload(newCoverPath, coverBlob, {
              contentType: ext === "png" ? "image/png" : "image/jpeg",
              upsert: true
            });
        }
      }

      // 4. Insert database record
      const { error: insertErr } = await supabase.from("books").insert({
        id: newBookId,
        user_id: user.id,
        title: openBook.title,
        author: openBook.author,
        cover_path: newCoverPath,
        file_path: newFilePath,
        toc: openBook.toc
      });
      if (insertErr) throw insertErr;

      alert(`Successfully imported "${openBook.title}" to My Library!`);
      setActiveTab("mine");
      refresh();
    } catch (err: any) {
      console.error("Import error:", err);
      alert(err.message || "Failed to import book.");
    } finally {
      setImportingBookId(null);
    }
  }

  // Admin Add to Open Library Logic
  async function handleAddToOpenLibrary(candidateBook: any) {
    if (!user) return;
    setAdminProcessingId(candidateBook.id);

    try {
      const supabase = createClient();
      const bookId = candidateBook.id;

      // 1. Download file
      const { data: fileBlob, error: downloadErr } = await supabase.storage
        .from("library")
        .download(candidateBook.file_path);
      if (downloadErr || !fileBlob) throw new Error("Could not download candidate file.");

      // 2. Upload to open library folder
      const openLibraryPath = `open_library/${bookId}/book.epub`;
      const { error: uploadErr } = await supabase.storage
        .from("library")
        .upload(openLibraryPath, fileBlob, { contentType: "application/epub+zip", upsert: true });
      if (uploadErr) throw uploadErr;

      // 3. Copy cover if exists
      let openCoverPath: string | null = null;
      if (candidateBook.cover_path) {
        const { data: coverBlob, error: coverDownloadErr } = await supabase.storage
          .from("library")
          .download(candidateBook.cover_path);
        
        if (!coverDownloadErr && coverBlob) {
          const ext = candidateBook.cover_path.endsWith("png") ? "png" : "jpg";
          openCoverPath = `open_library/${bookId}/cover.${ext}`;
          await supabase.storage
            .from("library")
            .upload(openCoverPath, coverBlob, {
              contentType: ext === "png" ? "image/png" : "image/jpeg",
              upsert: true
            });
        }
      }

      // 4. Insert into open_library_books
      const { error: insertErr } = await supabase.from("open_library_books").insert({
        title: candidateBook.title,
        author: candidateBook.author,
        cover_path: openCoverPath,
        file_path: openLibraryPath,
        toc: candidateBook.toc,
        uploader_email: null
      });
      if (insertErr) throw insertErr;

      alert(`"${candidateBook.title}" successfully added to Open Library!`);
      refresh();
    } catch (err: any) {
      console.error("Add to Open Library error:", err);
      alert(err.message || "Failed to add to Open Library.");
    } finally {
      setAdminProcessingId(null);
    }
  }

  // Admin Remove from Open Library Logic
  async function handleRemoveFromOpenLibrary(openBook: any) {
    if (!window.confirm(`Are you sure you want to remove "${openBook.title}" from the Open Library?`)) return;
    setAdminProcessingId(openBook.id);

    try {
      const supabase = createClient();
      
      const paths = [openBook.file_path, openBook.cover_path].filter((p): p is string => !!p);
      if (paths.length > 0) {
        await supabase.storage.from("library").remove(paths);
      }

      const { error } = await supabase.from("open_library_books").delete().eq("id", openBook.id);
      if (error) throw error;

      alert(`"${openBook.title}" successfully removed from Open Library.`);
      refresh();
    } catch (err: any) {
      console.error("Remove from Open Library error:", err);
      alert(err.message || "Failed to remove from Open Library.");
    } finally {
      setAdminProcessingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Library</h1>
        <div className={styles.tabContainer}>
          <button
            className={`${styles.tabButton} ${activeTab === "mine" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("mine")}
          >
            My Books ({books.length})
          </button>
          <button
            className={`${styles.tabButton} ${activeTab === "open" ? styles.tabButtonActive : ""}`}
            onClick={() => setActiveTab("open")}
          >
            Open Library ({openLibraryBooks.length})
          </button>
          {user?.email === "qumailaunali@gmail.com" && (
            <button
              className={`${styles.tabButton} ${activeTab === "admin" ? styles.tabButtonActive : ""}`}
              onClick={() => setActiveTab("admin")}
            >
              Admin Dashboard
            </button>
          )}
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.infoButton}
            onClick={() => setShowInfoModal(true)}
            title="App Features Guide"
          >
            ℹ️ Features
          </button>
          {activeTab === "mine" && (
            <>
              <button
                className={styles.importBookButton}
                onClick={() => setActiveTab("open")}
              >
                Import Book
              </button>
              <button className={styles.addButton} onClick={() => setShowUpload(true)}>
                + Add a book
              </button>
            </>
          )}
          {activeTab === "open" && (
            <>
              <button
                className={styles.wantMoreButton}
                onClick={() => setShowImportSources(true)}
              >
                Want more books?
              </button>
              {user?.email === "qumailaunali@gmail.com" && (
                <button className={styles.addButton} onClick={() => setShowUpload(true)}>
                  + Add to Open Library
                </button>
              )}
            </>
          )}</div>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading your library…</div>
      ) : activeTab === "mine" ? (
        <LibraryGrid
          books={books}
          progressByBook={progressByBook}
          coverUrls={coverUrls}
          onDelete={handleDelete}
        />
      ) : activeTab === "open" ? (
        openLibraryBooks.length === 0 ? (
          <div className={styles.emptyStateContainer}>
            <div className={styles.emptyStateIcon}>📖</div>
            <h3 className={styles.emptyStateTitle}>Open Library is empty</h3>
            <p className={styles.emptyStateText}>There are no books inside the public catalog yet.</p>
          </div>
        ) : (
          <div className={styles.openLibraryGrid}>
            {openLibraryBooks.map((ob) => {
              const alreadyHas = books.some(
                (b) =>
                  b.title.toLowerCase().trim() === ob.title.toLowerCase().trim() &&
                  (b.author || "").toLowerCase().trim() === (ob.author || "").toLowerCase().trim()
              );
              return (
                <div key={ob.id} className={styles.openBookCard}>
                  <div className={styles.openCoverWrap}>
                    {coverUrls[ob.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverUrls[ob.id]} alt={ob.title} className={styles.openCoverImage} />
                    ) : (
                      <div className={styles.openCoverPlaceholder}>📖</div>
                    )}
                  </div>
                  <div className={styles.openBookInfo}>
                    <div className={styles.openBookTitle} title={ob.title}>{ob.title}</div>
                    <div className={styles.openBookAuthor}>{ob.author || "Unknown Author"}</div>
                    
                    <button
                      className={styles.importButton}
                      onClick={() => handleImportBook(ob)}
                      disabled={importingBookId !== null || alreadyHas}
                    >
                      {importingBookId === ob.id ? (
                        <span className={styles.spinnerInline}>Importing...</span>
                      ) : alreadyHas ? (
                        "✓ In Library"
                      ) : (
                        "Import Book"
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className={styles.adminDashboard}>
          <div className={styles.adminSection}>
            <h2>Uploaded Books from Community ({allUploadedBooks.length})</h2>
            <p className={styles.sectionDesc}>Select books from active users to publish to the Open Library.</p>
            <div className={styles.adminTable}>
              {allUploadedBooks.map((cb) => (
                <div key={cb.id} className={styles.adminRow}>
                  <div className={styles.adminRowMain}>
                    <span className={styles.adminBookTitle}>{cb.title}</span>
                    <span className={styles.adminBookAuthor}>by {cb.author || "Unknown"}</span>
                  </div>
                  <button
                    className={styles.adminActionButton}
                    onClick={() => handleAddToOpenLibrary(cb)}
                    disabled={adminProcessingId !== null}
                  >
                    {adminProcessingId === cb.id ? "Adding..." : "Add to Open Library"}
                  </button>
                </div>
              ))}
              {allUploadedBooks.length === 0 && (
                <div className={styles.emptyStateTable}>No new community uploads awaiting review.</div>
              )}
            </div>
          </div>

          <div className={styles.adminSection}>
            <h2>Manage Shared Catalog ({openLibraryBooks.length})</h2>
            <p className={styles.sectionDesc}>Remove books from the public Open Library catalog.</p>
            <div className={styles.adminTable}>
              {openLibraryBooks.map((ob) => (
                <div key={ob.id} className={styles.adminRow}>
                  <div className={styles.adminRowMain}>
                    <span className={styles.adminBookTitle}>{ob.title}</span>
                    <span className={styles.adminBookAuthor}>by {ob.author || "Unknown"}</span>
                  </div>
                  <button
                    className={`${styles.adminActionButton} ${styles.adminDangerButton}`}
                    onClick={() => handleRemoveFromOpenLibrary(ob)}
                    disabled={adminProcessingId !== null}
                  >
                    {adminProcessingId === ob.id ? "Removing..." : "Remove"}
                  </button>
                </div>
              ))}
              {openLibraryBooks.length === 0 && (
                <div className={styles.emptyStateTable}>No books inside the Open Library yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showUpload && (
        <BookUploadModal
          mode={activeTab === "open" ? "open" : "private"}
          onClose={() => setShowUpload(false)}
          onUploaded={refresh}
        />
      )}
      
      {showImportSources && (
        <ImportBookModal
          onClose={() => setShowImportSources(false)}
        />
      )}

      {showInfoModal && (
        <div className={styles.infoOverlay} onClick={() => setShowInfoModal(false)}>
          <div className={styles.infoCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.infoTitleRow}>
              <h2 className={styles.infoTitle}>
                <span>ℹ️</span> Colophon Features Guide
              </h2>
              <button
                className={styles.infoClose}
                onClick={() => setShowInfoModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className={styles.infoDescription}>
              Explore the advanced reading and study tools built directly into Colophon.
            </p>

            <div className={styles.featuresList}>
              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>⚡</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Smart AI Summaries</h4>
                  <p className={styles.featureText}>Extract key-point summaries and outlines of any book page instantly with one click.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🎴</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>3D Flippable Flashcards</h4>
                  <p className={styles.featureText}>Auto-generate interactive study card decks to practice active recall on book pages.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>💬</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>"Ask the Book" Chat</h4>
                  <p className={styles.featureText}>Engage in an interactive chat session to ask the AI assistant questions about the active text.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🗣️</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Premium TTS Read-Aloud</h4>
                  <p className={styles.featureText}>Listen to chapters with natural regional Azure voices. Custom sleep timers and speech configurations are supported.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>📖</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Open Library Sharing</h4>
                  <p className={styles.featureText}>Access a public community catalog to import shared books or contribute new EPUB files.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🔍</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Wiktionary Lookup & Audio</h4>
                  <p className={styles.featureText}>Press and hold any word in the reader to view full dictionary definitions and trigger audio pronunciation guides.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🎨</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Sticky Tape Highlights</h4>
                  <p className={styles.featureText}>Mark key quotes with a translucent sticky tape marker, and bookmark page coordinates for easy navigation.</p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>👤</span>
                <div className={styles.featureBody}>
                  <h4 className={styles.featureName}>Guest Read Mode</h4>
                  <p className={styles.featureText}>Browse and use all key reader features as a guest without needing registration or saving personal info.</p>
                </div>
              </div>
            </div>

            <button className={styles.infoCloseBtn} onClick={() => setShowInfoModal(false)}>
              Got it, let's explore!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
