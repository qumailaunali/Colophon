/**
 * Browser/PWA capability helpers, mainly to cope with iOS Safari:
 * - iPhone Safari has no element Fullscreen API at all (iPad only has the
 *   webkit-prefixed one), so "full screen" there means installing the app.
 * - iOS never fires `beforeinstallprompt`; installing is a manual
 *   Share > Add to Home Screen step the app can only explain.
 */

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export const SHOW_INSTALL_HELP_EVENT = "colophon:show-install-help";
export const INSTALL_EVENT = "colophon:install";

export function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isFullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as WebkitDocument;
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function getFullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export async function toggleDocumentFullscreen(): Promise<void> {
  const doc = document as WebkitDocument;
  const el = document.documentElement as WebkitElement;
  try {
    if (getFullscreenElement()) {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) {
      await el.requestFullscreen();
    } else {
      await el.webkitRequestFullscreen?.();
    }
  } catch {
    // Denied or interrupted; nothing useful to report to the reader.
  }
}

/** Ask the InstallPrompt banner to show its install instructions. */
export function requestInstallHelp(): void {
  window.dispatchEvent(new Event(SHOW_INSTALL_HELP_EVENT));
}

/**
 * Install now: opens the browser's install dialog where one exists
 * (Android/Chromium), otherwise shows the manual steps (iOS). Call from a
 * click handler — the native dialog needs the user gesture.
 */
export function requestInstall(): void {
  window.dispatchEvent(new Event(INSTALL_EVENT));
}

/** Phones and tablets: Android, iPhone, iPad (incl. iPadOS posing as a Mac). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}
