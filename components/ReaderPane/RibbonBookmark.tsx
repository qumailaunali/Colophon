import styles from "./RibbonBookmark.module.css";

export function RibbonBookmark({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <div className={styles.ribbonTrack} aria-hidden="true">
      <div className={styles.ribbon} style={{ height: `${clamped * 100}%` }} />
    </div>
  );
}
