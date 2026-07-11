"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useReaderSettings } from "@/lib/hooks/useReaderSettings";
import { SettingsPanel } from "@/components/SettingsPanel/SettingsPanel";
import styles from "./page.module.css";

export default function SettingsPage() {
  const router = useRouter();
  const { settings, loaded, updateSettings } = useReaderSettings();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    if (
      !window.confirm(
        "Delete your account? This permanently removes every book, highlight, and setting. This cannot be undone."
      )
    ) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete account");
      }
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete account");
      setDeleting(false);
    }
  }

  return (
    <div className={styles.page}>
      <h1>Settings</h1>

      <div className={styles.section}>
        <h2>Reading display</h2>
        {loaded && <SettingsPanel settings={settings} onChange={updateSettings} />}
      </div>

      <div className={`${styles.section} ${styles.dangerSection}`}>
        <h2>Delete account</h2>
        <p className={styles.dangerText}>
          Permanently deletes your account along with every book, highlight, and reading setting.
          Individual books can be removed from the Library page instead, if that&rsquo;s all you need.
        </p>
        <button className={styles.deleteButton} onClick={handleDeleteAccount} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete account"}
        </button>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
