"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { TocEntry } from "@/lib/supabase/types";

interface SidebarTocState {
  bookTitle: string | null;
  entries: TocEntry[];
  currentSpineIndex: number;
  onSelect: ((spineIndex: number) => void) | null;
}

interface SidebarTocContextValue extends SidebarTocState {
  setToc: (state: SidebarTocState) => void;
  clearToc: () => void;
  /** Lets the book page's immersive/distraction-free mode hide the sidebar
   * entirely, independent of the TOC contents it's currently showing. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

const EMPTY_STATE: SidebarTocState = {
  bookTitle: null,
  entries: [],
  currentSpineIndex: -1,
  onSelect: null,
};

const SidebarTocContext = createContext<SidebarTocContextValue | null>(null);

export function SidebarTocProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SidebarTocState>(EMPTY_STATE);
  const [hidden, setHidden] = useState(false);

  const value = useMemo<SidebarTocContextValue>(
    () => ({
      ...state,
      setToc: setState,
      clearToc: () => {
        setState(EMPTY_STATE);
        setHidden(false);
      },
      hidden,
      setHidden,
    }),
    [state, hidden]
  );

  return <SidebarTocContext.Provider value={value}>{children}</SidebarTocContext.Provider>;
}

export function useSidebarToc() {
  const ctx = useContext(SidebarTocContext);
  if (!ctx) throw new Error("useSidebarToc must be used within SidebarTocProvider");
  return ctx;
}
