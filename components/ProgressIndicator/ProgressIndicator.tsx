import { useRef, useState } from "react";
import styles from "./ProgressIndicator.module.css";

const DRAG_THRESHOLD = 12; // pixels

interface ProgressIndicatorProps {
  percent: number;
  currentPage: number;
  totalPages: number;
  minutesRemaining: number;
  compact?: boolean;
  onDark?: boolean;
  onJumpToPercent?: (percent: number) => void;
}

export function ProgressIndicator({
  percent,
  currentPage,
  totalPages,
  minutesRemaining,
  compact,
  onDark,
  onJumpToPercent,
}: ProgressIndicatorProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const calculatePercent = (clientX: number): number => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const width = rect.width;
    const offsetX = clientX - rect.left;
    const ratio = offsetX / width;
    return Math.max(0, Math.min(100, ratio * 100));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onJumpToPercent) return;
    
    const startX = e.clientX;
    let dragActivated = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = Math.abs(moveEvent.clientX - startX);
      if (!dragActivated && deltaX > DRAG_THRESHOLD) {
        dragActivated = true;
        setIsDragging(true);
      }

      if (dragActivated) {
        const p = calculatePercent(moveEvent.clientX);
        onJumpToPercent(p);
      }
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      
      // If they released the mouse without ever crossing the drag threshold,
      // treat it as a deliberate single click-to-jump.
      if (!dragActivated) {
        const newPercent = calculatePercent(upEvent.clientX);
        onJumpToPercent(newPercent);
      } else {
        setIsDragging(false);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!onJumpToPercent) return;

    const startX = e.touches[0].clientX;
    let dragActivated = false;

    const handleTouchMove = (moveEvent: TouchEvent) => {
      const deltaX = Math.abs(moveEvent.touches[0].clientX - startX);
      if (!dragActivated && deltaX > DRAG_THRESHOLD) {
        dragActivated = true;
        setIsDragging(true);
      }

      if (dragActivated) {
        const p = calculatePercent(moveEvent.touches[0].clientX);
        onJumpToPercent(p);
      }
    };

    const handleTouchEnd = (endEvent: TouchEvent) => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);

      if (!dragActivated) {
        // If they tapped without dragging past the threshold, jump to tap position.
        const clientX = endEvent.changedTouches[0].clientX;
        const newPercent = calculatePercent(clientX);
        onJumpToPercent(newPercent);
      } else {
        setIsDragging(false);
      }
    };

    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleTouchEnd);
  };

  return (
    <div
      className={`${styles.wrap} ${compact ? styles.compact : ""} ${onDark ? styles.onDark : ""} ${
        onJumpToPercent ? styles.interactive : ""
      } ${isDragging ? styles.dragging : ""}`}
    >
      <div
        ref={barRef}
        className={styles.bar}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
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
