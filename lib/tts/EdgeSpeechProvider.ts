import type { TTSProvider, TTSSpeakCallbacks, TTSUtteranceOptions, TTSVoice } from "./TTSProvider";

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

  private prefetched: PrefetchedAudio | null = null;

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

  prefetch(text: string, options: TTSUtteranceOptions): void {
    // If already prefetching the exact same thing, do nothing
    if (
      this.prefetched &&
      this.prefetched.text === text &&
      this.prefetched.voiceName === options.voiceName &&
      this.prefetched.pitch === options.pitch
    ) {
      return;
    }

    // Cancel any existing prefetch
    if (this.prefetched) {
      this.prefetched.abortController.abort();
      if (this.prefetched.audio) {
        this.prefetched.audio.onended = null;
        this.prefetched.audio.onerror = null;
        this.prefetched.audio.pause();
      }
      if (this.prefetched.url) {
        URL.revokeObjectURL(this.prefetched.url);
      }
      this.prefetched = null;
    }

    const abortController = new AbortController();
    const pref: PrefetchedAudio = {
      text,
      voiceName: options.voiceName,
      pitch: options.pitch,
      url: null,
      blob: null,
      promise: null,
      abortController,
      audio: null,
    };

    pref.promise = (async () => {
      try {
        const res = await fetch("/api/tts/edge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voiceName: options.voiceName || undefined,
            pitch: options.pitch,
          }),
          signal: abortController.signal,
        });

        if (!res.ok) return;

        const blob = await res.blob();
        if (blob.size === 0) return;

        pref.blob = blob;
        pref.url = URL.createObjectURL(blob);

        // Pre-create and preload the audio element to avoid setup/buffering lag during play
        const audio = new Audio(pref.url);
        audio.preload = "auto";
        audio.load();
        pref.audio = audio;
      } catch (e) {
        // Ignore errors in prefetch, we will fall back to normal fetch in speak()
      }
    })();

    this.prefetched = pref;
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

    this.attemptSpeak(text, options, callbacks, controller, 1)
      .then(() => callbacks.onEnd())
      .catch((error) => {
        if (controller.signal.aborted) return;
        callbacks.onError(error);
      });
  }

  /** Fetches + plays once; on any failure (bad response, empty/corrupt
   * audio, decode error) retries the whole round-trip `retriesLeft` more
   * times before giving up, to smooth over transient network hiccups. */
  private async attemptSpeak(
    text: string,
    options: TTSUtteranceOptions,
    callbacks: TTSSpeakCallbacks,
    controller: AbortController,
    retriesLeft: number
  ): Promise<void> {
    try {
      let url: string;
      let blob: Blob;
      let existingAudio: HTMLAudioElement | undefined;

      // Check if we have a matching prefetched item
      if (
        this.prefetched &&
        this.prefetched.text === text &&
        this.prefetched.voiceName === options.voiceName &&
        this.prefetched.pitch === options.pitch
      ) {
        console.log(`[Edge TTS] Prefetch HIT for: "${text.substring(0, 30)}..."`);
        const startTime = Date.now();
        // Wait for prefetch promise to resolve
        await this.prefetched.promise;
        console.log(`[Edge TTS] Prefetch promise resolved in ${Date.now() - startTime}ms`);
        
        if (this.prefetched.url && this.prefetched.blob) {
          url = this.prefetched.url;
          blob = this.prefetched.blob;
          existingAudio = this.prefetched.audio || undefined;
          // Clear this.prefetched container without revoking the URL, as we are now playing it.
          this.prefetched = null;
        } else {
          console.warn("[Edge TTS] Prefetch resolved but had no URL/Blob. Falling back to normal fetch.");
          // Prefetch failed, clean up and do a normal fetch
          if (this.prefetched.url) {
            URL.revokeObjectURL(this.prefetched.url);
          }
          this.prefetched = null;
          return this.doNormalSpeakFetch(text, options, callbacks, controller, retriesLeft);
        }
      } else {
        // No match, or no prefetch. Clean up any existing prefetch.
        if (this.prefetched) {
          console.warn(
            `[Edge TTS] Prefetch MISMATCH/BYPASS.\nExpected: "${this.prefetched.text.substring(0, 30)}..."\nRequested: "${text.substring(0, 30)}..."`
          );
          this.prefetched.abortController.abort();
          if (this.prefetched.audio) {
            this.prefetched.audio.onended = null;
            this.prefetched.audio.onerror = null;
            this.prefetched.audio.ontimeupdate = null;
            this.prefetched.audio.pause();
          }
          if (this.prefetched.url) {
            URL.revokeObjectURL(this.prefetched.url);
          }
          this.prefetched = null;
        } else {
          console.log(`[Edge TTS] No prefetch exists for: "${text.substring(0, 30)}..."`);
        }
        return this.doNormalSpeakFetch(text, options, callbacks, controller, retriesLeft);
      }

      await this.playAudioUrl(url, options, existingAudio);
    } catch (error) {
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
      this.audio = null;

      if (controller.signal.aborted) throw error;
      if (retriesLeft > 0) {
        console.warn("[Edge TTS] retrying after error:", error);
        return this.attemptSpeak(text, options, callbacks, controller, retriesLeft - 1);
      }
      throw error;
    }
  }

  private async doNormalSpeakFetch(
    text: string,
    options: TTSUtteranceOptions,
    callbacks: TTSSpeakCallbacks,
    controller: AbortController,
    retriesLeft: number
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
      throw new Error(body.error || `Edge Speech request failed (${res.status})`);
    }

    const blob = await res.blob();
    if (blob.size === 0) {
      throw new Error("Edge returned an empty audio response");
    }

    const url = URL.createObjectURL(blob);
    await this.playAudioUrl(url, options);
  }

  private async playAudioUrl(url: string, options: TTSUtteranceOptions, existingAudio?: HTMLAudioElement): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const audio = existingAudio || new Audio(url);
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
      audio.play().catch(reject);
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
    if (this.prefetched) {
      this.prefetched.abortController.abort();
      if (this.prefetched.audio) {
        this.prefetched.audio.onended = null;
        this.prefetched.audio.ontimeupdate = null;
        this.prefetched.audio.onerror = null;
        this.prefetched.audio.pause();
      }
      if (this.prefetched.url) {
        URL.revokeObjectURL(this.prefetched.url);
      }
      this.prefetched = null;
    }
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
