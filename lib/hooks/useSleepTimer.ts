"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useSleepTimer(onElapsed: () => void) {
  const [minutesRemaining, setMinutesRemaining] = useState<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onElapsedRef = useRef(onElapsed);

  useEffect(() => {
    onElapsedRef.current = onElapsed;
  }, [onElapsed]);

  const cancel = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
    setMinutesRemaining(null);
  }, []);

  const start = useCallback(
    (minutes: number) => {
      cancel();
      const endAt = Date.now() + minutes * 60_000;
      setMinutesRemaining(minutes);
      intervalRef.current = setInterval(() => {
        setMinutesRemaining(Math.max(0, Math.ceil((endAt - Date.now()) / 60_000)));
      }, 15_000);
      timeoutRef.current = setTimeout(() => {
        cancel();
        onElapsedRef.current();
      }, minutes * 60_000);
    },
    [cancel]
  );

  useEffect(() => cancel, [cancel]);

  return { minutesRemaining, start, cancel };
}
