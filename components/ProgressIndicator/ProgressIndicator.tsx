import styles from "./ProgressIndicator.module.css";

interface ProgressIndicatorProps {
  percent: number;
  currentPage: number;
  totalPages: number;
  minutesRemaining: number;
  compact?: boolean;
  onDark?: boolean;
}

export function ProgressIndicator({
  percent,
  currentPage,
  totalPages,
  minutesRemaining,
  compact,
  onDark,
}: ProgressIndicatorProps) {
  return (
    <div
      className={`${styles.wrap} ${compact ? styles.compact : ""} ${onDark ? styles.onDark : ""}`}
    >
      <div className={styles.bar}>
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
      <div className={styles.meta}>
        <span>{Math.round(percent)}%</span>
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <span>{formatMinutes(minutesRemaining)} left</span>
      </div>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
