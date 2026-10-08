"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AdminUser } from "@/lib/supabase/admin";
import styles from "./page.module.css";

type SortKey = "newest" | "oldest" | "recent_activity" | "most_books" | "email";

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function relativeTime(value: string | null, now: number) {
  if (!value) return "Never signed in";
  const days = Math.floor((now - new Date(value).getTime()) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

export function UsersManager({
  initialUsers,
  initialError,
}: {
  initialUsers: AdminUser[];
  initialError: string | null;
}) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load users.");
      setUsers(body.users);
      setLoadedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    const now = loadedAt;
    return {
      total: users.length,
      activeLast30: users.filter(
        (u) => u.last_sign_in_at && now - new Date(u.last_sign_in_at).getTime() < 30 * DAY_MS
      ).length,
      newLast7: users.filter((u) => now - new Date(u.created_at).getTime() < 7 * DAY_MS).length,
      books: users.reduce((sum, u) => sum + u.book_count, 0),
    };
  }, [users, loadedAt]);

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? users.filter(
          (u) =>
            (u.email ?? "").toLowerCase().includes(q) ||
            (u.name ?? "").toLowerCase().includes(q) ||
            u.id.includes(q)
        )
      : users;

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.created_at.localeCompare(b.created_at);
        case "recent_activity":
          return (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? "");
        case "most_books":
          return b.book_count - a.book_count;
        case "email":
          return (a.email ?? "").localeCompare(b.email ?? "");
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
  }, [users, query, sort]);

  async function handleDelete(target: AdminUser) {
    if (
      !window.confirm(
        `Permanently delete ${target.email ?? "this user"}?\n\nThis removes their account, ${target.book_count} book(s), highlights and reading progress. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeletingId(target.id);
    try {
      const res = await fetch(`/api/admin/users/${target.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to delete user.");
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete user.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <Link href="/library" className={styles.backLink}>
            ← Back to Library
          </Link>
          <h1>Users</h1>
          <p className={styles.subtitle}>Everyone registered on Colophon.</p>
        </div>
        <button className={styles.refreshButton} onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className={styles.stats}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{loading ? "–" : stats.total}</span>
          <span className={styles.statLabel}>Total users</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{loading ? "–" : stats.activeLast30}</span>
          <span className={styles.statLabel}>Active in last 30 days</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{loading ? "–" : stats.newLast7}</span>
          <span className={styles.statLabel}>Joined this week</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{loading ? "–" : stats.books}</span>
          <span className={styles.statLabel}>Books uploaded</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={styles.sortSelect}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort users"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="recent_activity">Recently active</option>
          <option value="most_books">Most books</option>
          <option value="email">Email A–Z</option>
        </select>
      </div>

      {error ? (
        <div className={styles.errorBox}>
          {error}
          <button className={styles.retryButton} onClick={load}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className={styles.empty}>Loading users…</div>
      ) : visibleUsers.length === 0 ? (
        <div className={styles.empty}>
          {query ? `No users match "${query}".` : "No registered users yet."}
        </div>
      ) : (
        <div className={styles.table} role="table">
          <div className={`${styles.row} ${styles.headRow}`} role="row">
            <span role="columnheader">User</span>
            <span role="columnheader">Joined</span>
            <span role="columnheader">Last sign-in</span>
            <span role="columnheader" className={styles.numCol}>Books</span>
            <span role="columnheader" />
          </div>
          {visibleUsers.map((u) => (
            <div key={u.id} className={styles.row} role="row">
              <div className={styles.userCell} role="cell">
                <span className={styles.avatar} aria-hidden>
                  {(u.name || u.email || "?").charAt(0).toUpperCase()}
                </span>
                <div className={styles.userText}>
                  <div className={styles.nameRow}>
                    <span className={styles.name} title={u.name ?? undefined}>
                      {u.name || "No name"}
                    </span>
                    {u.is_admin && <span className={styles.adminBadge}>Admin</span>}
                  </div>
                  <span className={styles.email} title={u.email ?? u.id}>
                    {u.email ?? "No email"}
                  </span>
                </div>
              </div>
              <span className={styles.cell} role="cell" data-label="Joined">
                {formatDate(u.created_at)}
              </span>
              <span
                className={styles.cell}
                role="cell"
                data-label="Last sign-in"
                title={formatDate(u.last_sign_in_at)}
              >
                {relativeTime(u.last_sign_in_at, loadedAt)}
              </span>
              <span className={`${styles.cell} ${styles.numCol}`} role="cell" data-label="Books">
                {u.book_count}
              </span>
              <div className={styles.actionCell} role="cell">
                {!u.is_admin && (
                  <button
                    className={styles.deleteButton}
                    onClick={() => handleDelete(u)}
                    disabled={deletingId !== null}
                  >
                    {deletingId === u.id ? "Deleting…" : "Delete"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
