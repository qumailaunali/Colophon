"use client";

import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onTogglePlay?: () => void;
}

function isTextInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isTextInputFocused()) return;

      if (e.key === "ArrowLeft") {
        handlersRef.current.onPrevPage?.();
      } else if (e.key === "ArrowRight") {
        handlersRef.current.onNextPage?.();
      } else if (e.key === " ") {
        e.preventDefault();
        handlersRef.current.onTogglePlay?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
