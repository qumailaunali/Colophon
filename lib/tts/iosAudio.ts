/**
 * iOS/iPadOS WebKit only lets an <audio> element play sound once that
 * element has been started from a user gesture. The TTS providers create a
 * fresh Audio per sentence and call play() after an async fetch, which iOS
 * rejects (NotAllowedError). On iOS we instead route every sentence through
 * one shared element that is "unlocked" synchronously inside the Play tap.
 * Other platforms are untouched: getSharedAudioElement() returns null there.
 */

// A valid 100ms silent clip. An empty WAV can fail decoding before unlocking.
function silentWav(): string {
  const bytes = new Uint8Array(844);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  label(0, "RIFF"); view.setUint32(4, 836, true);
  label(8, "WAVEfmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  label(36, "data"); view.setUint32(40, 800, true);
  bytes.fill(128, 44);
  return "data:audio/wav;base64," + btoa(String.fromCharCode(...bytes));
}

let sharedAudio: HTMLAudioElement | null = null;
let unlocked = false;
export const AUDIO_TAP_EVENT = "colophon:audio-tap-needed";
let pendingRetry: (() => void) | null = null;

function isPlaybackBlocked(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "NotAllowedError";
}

export function retryPendingAudio(): boolean {
  if (!pendingRetry) return false;
  pendingRetry();
  return true;
}

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
  sharedAudio.src = silentWav();
  // Invoke synchronously on tap; a rejected unlock must remain retryable.
  sharedAudio.play().then(() => { unlocked = true; }).catch(() => { unlocked = false; });
}

export function playAudioElement(audio: HTMLAudioElement, signal?: AbortSignal): Promise<void> {
  audio.setAttribute("playsinline", "");
  return audio.play().catch((error: unknown) => {
    if (audio === sharedAudio) unlocked = false;
    if (!isPlaybackBlocked(error)) throw error;
    // Keep the fetched clip loaded. Retry this exact element synchronously on
    // the next tap rather than fetching another clip outside user activation.
    return new Promise<void>((resolve, reject) => {
      const clear = () => {
        pendingRetry = null;
        signal?.removeEventListener("abort", abort);
        window.dispatchEvent(new CustomEvent(AUDIO_TAP_EVENT, { detail: false }));
      };
      const abort = () => { clear(); reject(new DOMException("Playback cancelled", "AbortError")); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      pendingRetry = () => {
        audio.play().then(() => { unlocked = audio === sharedAudio; clear(); resolve(); }).catch((retryError: unknown) => {
          if (isPlaybackBlocked(retryError)) return;
          clear(); reject(retryError);
        });
      };
      window.dispatchEvent(new CustomEvent(AUDIO_TAP_EVENT, { detail: true }));
    });
  });
}
