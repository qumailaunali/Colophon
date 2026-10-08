/**
 * iOS/iPadOS WebKit only lets an <audio> element play sound once that
 * element has been started from a user gesture. The TTS providers create a
 * fresh Audio per sentence and call play() after an async fetch, which iOS
 * rejects (NotAllowedError). On iOS we instead route every sentence through
 * one shared element that is "unlocked" synchronously inside the Play tap.
 * Other platforms are untouched: getSharedAudioElement() returns null there.
 */

// 44-byte WAV header with no samples: enough to call play() on.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

let sharedAudio: HTMLAudioElement | null = null;
let unlocked = false;

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; touch support gives it away.
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/** The shared element to play TTS through, or null when not needed (non-iOS). */
export function getSharedAudioElement(): HTMLAudioElement | null {
  return sharedAudio;
}

/** Call synchronously from a user gesture (e.g. the Play button handler). */
export function unlockSharedAudioElement(): void {
  if (unlocked || !isIOSDevice()) return;
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.setAttribute("playsinline", "");
    sharedAudio.preload = "auto";
  }
  sharedAudio.src = SILENT_WAV;
  // WebKit lifts the element's gesture restriction when play() is invoked
  // inside the gesture, even if this particular (empty) clip fails to play.
  sharedAudio.play().catch(() => {});
  unlocked = true;
}
