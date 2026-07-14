"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSidebarToc } from "@/lib/context/SidebarTocContext";
import styles from "./Sidebar.module.css";

const NAV_LINKS = [
  { href: "/library", label: "Library" },
  { href: "/settings", label: "Settings" },
];

const COLLAPSED_STORAGE_KEY = "colophon-sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { bookTitle, entries, currentSpineIndex, onSelect, hidden } = useSidebarToc();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (hidden) return null;

  return (
    <>
      <button
        className={styles.menuButton}
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        ☰
      </button>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}

      <aside
        className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""} ${
          collapsed ? styles.sidebarCollapsed : ""
        }`}
      >
        <div className={styles.brandRow}>
          <div className={styles.brandMark}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" width={28} height={28} className={styles.brandLogo} />
            <span className={`${styles.brand} ${styles.hideWhenCollapsed}`}>Colophon</span>
          </div>
          <button
            className={styles.collapseButton}
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        <nav className={`${styles.nav} ${styles.hideWhenCollapsed}`}>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.navLink} ${
                pathname.startsWith(link.href) ? styles.navLinkActive : ""
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {entries.length > 0 ? (
          <div className={`${styles.tocSection} ${styles.hideWhenCollapsed}`}>
            <div className={styles.tocTitle}>{bookTitle ?? "Contents"}</div>
            {entries.map((entry, index) => (
              <button
                key={`${index}-${entry.spineIndex}-${entry.href}`}
                className={`${styles.tocEntry} ${
                  entry.spineIndex === currentSpineIndex ? styles.tocEntryActive : ""
                }`}
                onClick={() => onSelect?.(entry.spineIndex)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.spacer} />
        )}

        <div className={`${styles.footer} ${styles.hideWhenCollapsed}`}>
          {email && <span>{email}</span>}
          <button className={styles.logout} onClick={handleLogout}>
            Log out
          </button>
        </div>
      </aside>
    </>
  );
}
