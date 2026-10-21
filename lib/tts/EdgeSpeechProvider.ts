import type { TTSProvider, TTSSpeakCallbacks, TTSUtteranceOptions, TTSVoice } from "./TTSProvider";
import { getSharedAudioElement, playAudioElement } from "./iosAudio";

function mediaErrorName(code: number | undefined): string {
  switch (code) {
    case 1:
      return "ABORTED";
    case 2:
      return "NETWORK";
    case 3:
      return "DECODE";
    case 4:
      return "SRC_NOT_SUPPORTED";
    default:
      return "UNKNOWN";
  }
}

/** Matches MAX_BATCH in /api/tts/edge: sentences fetched per connection. */
const PREFETCH_BATCH_SIZE = 5;
/** A new batch is only started once one of this many upcoming sentences is
 * neither cached nor in flight; otherwise each sentence advance would send
 * its own one-sentence request. */
const PREFETCH_REFILL_AHEAD = 2;
const PREFETCH_LIMIT = 10;
// Backoff when Microsoft rate-limits us (HTTP 429): 1s, 2s, 4s ... capped
// at 30s, with jitter, giving up after ~1 minute of retries.
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const MAX_THROTTLE_RETRIES = 6;

/** The Edge route answered 429: Microsoft is rate-limiting the server. */
class EdgeThrottledError extends Error {
  name = "EdgeThrottledError";
  constructor(message: string, public retryAfterMs: number | null) {
    super(message);
  }
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function backoffDelay(attempt: number, retryAfter: number | null): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  const jittered = exp / 2 + Math.random() * (exp / 2);
  return Math.max(jittered, retryAfter ?? 0);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Edge speech request cancelled"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Edge speech request cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "audio/mpeg" });
}

interface PrefetchedAudio {
  text: string;
  voiceName?: string | null;
  pitch: number;
  url: string | null;
  blob: Blob | null;
  promise: Promise<void> | null;
  abortController: AbortController;
  audio: HTMLAudioElement | null;
}

/**
 * Free neural provider backed by Microsoft Edge TTS, calling our
 * own /api/tts/edge routes so no API key is required. Speed/volume are
 * applied via the <audio> element itself.
 */
export class EdgeSpeechProvider implements TTSProvider {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private abortController: AbortController | null = null;
  private voicesCache: TTSVoice[] | null = null;

  private prefetchMap: Map<string, PrefetchedAudio> = new Map();
  private pendingPrefetch: { text: string; options: TTSUtteranceOptions }[] = [];
  private prefetchFlushScheduled = false;
  /** While Date.now() is before this, prefetching is paused so a throttled
   * server isn't hit with more handshakes. */
  private throttledUntil = 0;

  private getCacheKey(text: string, options: TTSUtteranceOptions): string {
    return `${text}:${options.voiceName || ""}:${options.pitch}`;
  }

  private clearPrefetchMap(): void {
    this.prefetchMap.forEach((pref) => {
      pref.abortController.abort();
      if (pref.audio) {
        pref.audio.onended = null;
        pref.audio.ontimeupdate = null;
        pref.audio.onerror = null;
        pref.audio.pause();
      }
      if (pref.url) {
        URL.revokeObjectURL(pref.url);
      }
    });
    this.prefetchMap.clear();
  }

  async listVoices(): Promise<TTSVoice[]> {
    if (this.voicesCache) return this.voicesCache;
    try {
      const res = await fetch("/api/tts/edge/voices");
      if (!res.ok) return [];
      const voices: TTSVoice[] = await res.json();
      this.voicesCache = voices;
      return voices;
    } catch {
      return [];
    }
  }

  /** Collects the prefetch() calls made in one tick (the controller asks for
   * the next few sentences in a row) and sends the missing ones as a single
   * batch request, i.e. one Edge connection for up to 5 sentences. */
  prefetch(text: string, options: TTSUtteranceOptions): void {
    if (Date.now() < this.throttledUntil) return;
    this.pendingPrefetch.push({ text, options });
    if (this.prefetchFlushScheduled) return;
    this.prefetchFlushScheduled = true;
    queueMicrotask(() => this.flushPrefetch());
  }

  private flushPrefetch(): void {
    this.prefetchFlushScheduled = false;
    const requested = this.pendingPrefetch;
    this.pendingPrefetch = [];
    if (!requested.length || Date.now() < this.throttledUntil) return;

    const isKnown = (r: { text: string; options: TTSUtteranceOptions }) =>
      this.prefetchMap.has(this.getCacheKey(r.text, r.options));
    if (requested.slice(0, PREFETCH_REFILL_AHEAD).every(isKnown)) return;

    // One request uses one voice/pitch; in practice every call in a tick shares them.
    const { voiceName, pitch } = requested[0].options;
    const batch = requested
      .filter((r) => !isKnown(r) && r.options.voiceName === voiceName && r.options.pitch === pitch)
      .slice(0, PREFETCH_BATCH_SIZE);
    if (!batch.length) return;

    this.evictPrefetch(batch.length);

    const abortController = new AbortController();
    const entries: PrefetchedAudio[] = batch.map((r) => ({
      text: r.text,
      voiceName,
      pitch,
      url: null,
      blob: null,
      promise: null,
      abortController,
      audio: null,
    }));

    const promise = (async () => {
      try {
        const res = await fetch("/api/tts/edge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts: batch.map((r) => r.text),
            voiceName: voiceName || undefined,
            pitch,
          }),
          signal: abortController.signal,
        });

        if (res.status === 429) {
          // Pause prefetching; speak() falls back to its own backoff.
          this.throttledUntil = Date.now() + backoffDelay(0, retryAfterMs(res));
          return;
        }
        if (!res.ok) return;

        const { audios } = (await res.json()) as { audios?: (string | null)[] };
        entries.forEach((pref, i) => {
          const base64 = audios?.[i];
          if (!base64 || abortController.signal.aborted) return;
          pref.blob = base64ToBlob(base64);
          pref.url = URL.createObjectURL(pref.blob);
          // Pre-create and preload the audio element to avoid setup/buffering lag during play
          const audio = new Audio(pref.url);
          audio.preload = "auto";
          audio.load();
          pref.audio = audio;
        });
      } catch {
        // Ignore errors in prefetch, we will fall back to normal fetch in speak()
      }
    })();

    entries.forEach((pref, i) => {
      pref.promise = promise;
      this.prefetchMap.set(this.getCacheKey(batch[i].text, batch[i].options), pref);
    });
  }

  /** Drops the oldest entries so `incoming` more fit under PREFETCH_LIMIT. */
  private evictPrefetch(incoming: number): void {
    while (this.prefetchMap.size > 0 && this.prefetchMap.size + incoming > PREFETCH_LIMIT) {
      const oldestKey = this.prefetchMap.keys().next().value;
      if (!oldestKey) break;
      const old = this.prefetchMap.get(oldestKey);
      this.prefetchMap.delete(oldestKey);
      if (!old) continue;
      if (old.audio) {
        old.audio.onended = null;
        old.audio.ontimeupdate = null;
        old.audio.onerror = null;
        old.audio.pause();
      }
      if (old.url) {
        URL.revokeObjectURL(old.url);
      }
      // Only cancel the request once no other sentence still waits on it.
      const shared = [...this.prefetchMap.values()].some((p) => p.abortController === old.abortController);
      if (!shared) old.abortController.abort();
    }
  }

  speak(text: string, options: TTSUtteranceOptions, callbacks: TTSSpeakCallbacks): void {
    // Stop and clean up any ongoing audio playback.
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;

    this.speakWithRetry(text, options, callbacks, controller)
      .then(() => callbacks.onEnd())
      .catch((error) => {
        if (controller.signal.aborted) return;
        callbacks.onError(error);
      });
  }

  /** Rate limits (429) are retried with exponential backoff while the UI
   * shows a "busy" state; any other failure (bad response, empty/corrupt
   * audio, decode error) is retried once to smooth over network hiccups.
   * Retrying happens inside this one speak() call, so the controller's
   * sentence cursor never moves. */
  private async speakWithRetry(
    text: string,
    options: TTSUtteranceOptions,
    callbacks: TTSSpeakCallbacks,
    controller: AbortController
  ): Promise<void> {
    let throttleRetries = 0;
    let otherRetries = 1;
    for (;;) {
      try {
        await this.attemptSpeak(text, options, controller, () => {
          if (throttleRetries > 0) callbacks.onStatus?.(null);
          this.throttledUntil = 0;
        });
        return;
      } catch (error) {
        if (this.objectUrl) {
          URL.revokeObjectURL(this.objectUrl);
          this.objectUrl = null;
        }
        this.audio = null;

        if (controller.signal.aborted) throw error;
        if (error instanceof EdgeThrottledError) {
          if (throttleRetries >= MAX_THROTTLE_RETRIES) {
            callbacks.onStatus?.(null);
            throw new Error("The voice service is busy right now. Please try again in a minute.");
          }
          const delay = backoffDelay(throttleRetries++, error.retryAfterMs);
          this.throttledUntil = Date.now() + delay;
          this.clearPrefetchMap();
          console.warn(`[Edge TTS] rate limited, retrying in ${Math.round(delay)}ms`);
          callbacks.onStatus?.("busy");
          await sleep(delay, controller.signal);
          continue;
        }
        if (otherRetries-- > 0) {
          console.warn("[Edge TTS] retrying after error:", error);
          continue;
        }
        throw error;
      }
    }
  }

  /** Fetches (or takes from the prefetch cache) and plays one sentence.
   * `onReady` fires once audio is in hand, just before playback starts. */
  private async attemptSpeak(
    text: string,
    options: TTSUtteranceOptions,
    controller: AbortController,
    onReady: () => void
  ): Promise<void> {
    const key = this.getCacheKey(text, options);
    const cached = this.prefetchMap.get(key);

    if (!cached) {
      console.log(`[Edge TTS] Prefetch MISS for: "${text.substring(0, 30)}..."`);
      // Clean up everything else to keep map small and focused
      this.clearPrefetchMap();
      return this.doNormalSpeakFetch(text, options, controller, onReady);
    }

    console.log(`[Edge TTS] Prefetch HIT for: "${text.substring(0, 30)}..."`);
    const startTime = Date.now();
    // Wait for prefetch promise to resolve
    await cached.promise;
    console.log(`[Edge TTS] Prefetch promise resolved in ${Date.now() - startTime}ms`);
    this.prefetchMap.delete(key);

    if (!cached.url || !cached.blob) {
      console.warn("[Edge TTS] Prefetch resolved but had no URL/Blob. Falling back to normal fetch.");
      return this.doNormalSpeakFetch(text, options, controller, onReady);
    }

    onReady();
    await this.playAudioUrl(cached.url, options, cached.audio || undefined);
  }

  private async doNormalSpeakFetch(
    text: string,
    options: TTSUtteranceOptions,
    controller: AbortController,
    onReady: () => void
  ): Promise<void> {
    const res = await fetch("/api/tts/edge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        voiceName: options.voiceName || undefined,
        pitch: options.pitch,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = body.error || `Edge Speech request failed (${res.status})`;
      if (res.status === 429) throw new EdgeThrottledError(message, retryAfterMs(res));
      throw new Error(message);
    }

    const blob = await res.blob();
    if (blob.size === 0) {
      throw new Error("Edge returned an empty audio response");
    }

    const url = URL.createObjectURL(blob);
    onReady();
    await this.playAudioUrl(url, options);
  }

  private async playAudioUrl(url: string, options: TTSUtteranceOptions, existingAudio?: HTMLAudioElement): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      // On iOS, play through the gesture-unlocked shared element (see iosAudio.ts).
      const shared = getSharedAudioElement();
      const audio = shared ?? existingAudio ?? new Audio(url);
      if (shared) shared.src = url;
      audio.playbackRate = options.rate;
      audio.volume = Math.min(1, Math.max(0, options.volume));
      this.audio = audio;
      this.objectUrl = url;

      let isFinished = false;
      const finish = () => {
        if (isFinished) return;
        isFinished = true;
        audio.onended = null;
        audio.ontimeupdate = null;
        audio.onerror = null;
        resolve();
      };

      audio.onended = finish;

      // Microsoft neural voices have about 120ms of leading silence and 350-400ms of trailing silence.
      // Transitioning early cuts this off and triggers the next sentence's preloaded audio.
      // We scale the threshold dynamically based on the duration to prevent cutting off short sentences.
      audio.ontimeupdate = () => {
        if (audio.duration && audio.duration > 0.3) {
          const silenceDuration = 0.42; // 420ms optimal overlap
          const maxCutoff = audio.duration * 0.20; // never trim more than 20% of a sentence
          const threshold = Math.min(silenceDuration, maxCutoff) / options.rate;
          if (audio.duration - audio.currentTime < threshold) {
            finish();
          }
        }
      };

      // Skip leading silence (approx 110ms) to start speaking immediately.
      // We wrap it in readyState checks to prevent InvalidStateError if metadata isn't loaded yet.
      const skipLeadingSilence = () => {
        try {
          if (audio.currentTime < 0.11) {
            audio.currentTime = 0.11;
          }
        } catch (e) {
          // ignore any errors from setting currentTime (e.g. if not seekable yet)
        }
      };

      if (audio.readyState >= 1) {
        skipLeadingSilence();
      } else {
        audio.onloadedmetadata = skipLeadingSilence;
      }

      audio.onerror = () => {
        isFinished = true;
        audio.onended = null;
        audio.ontimeupdate = null;
        audio.onerror = null;
        reject(new Error(`Edge audio playback failed (${mediaErrorName(audio.error?.code)})`));
      };
      playAudioElement(audio, this.abortController?.signal).catch(reject);
    });
  }

  private cleanup(): void {
    this.abortController?.abort();
    this.abortController = null;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.ontimeupdate = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.clearPrefetchMap();
  }

  pause(): void {
    this.audio?.pause();
  }

  resume(): void {
    this.audio?.play().catch(() => {});
  }

  stop(): void {
    this.cleanup();
  }

  isSpeaking(): boolean {
    return !!this.audio && !this.audio.paused;
  }

  isPaused(): boolean {
    return !!this.audio && this.audio.paused;
  }
}
