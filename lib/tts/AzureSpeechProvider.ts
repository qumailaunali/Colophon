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
 * Premium provider backed by Azure Cognitive Services Speech, calling our
 * own /api/tts/azure routes (never the Azure key) so the subscription key
 * stays server-only. Speed/volume are applied via the <audio> element
 * itself rather than SSML, since many neural voices only partly support
 * SSML <prosody> rate/volume — see lib/tts/azureSsml.ts.
 */
export class AzureSpeechProvider implements TTSProvider {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private abortController: AbortController | null = null;
  private voicesCache: TTSVoice[] | null = null;

  private prefetched: PrefetchedAudio | null = null;

  async listVoices(): Promise<TTSVoice[]> {
    if (this.voicesCache) return this.voicesCache;
    try {
      const res = await fetch("/api/tts/azure/voices");
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
        this.prefetched.audio.pause();
        this.prefetched.audio.onended = null;
        this.prefetched.audio.onerror = null;
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
        const res = await fetch("/api/tts/azure", {
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
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
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
   * times before giving up, to smooth over transient network hiccups
   * between this server and Azure. */
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
        // Wait for prefetch promise to resolve
        await this.prefetched.promise;
        if (this.prefetched.url && this.prefetched.blob) {
          url = this.prefetched.url;
          blob = this.prefetched.blob;
          existingAudio = this.prefetched.audio || undefined;
          // Clear this.prefetched container without revoking the URL, as we are now playing it.
          this.prefetched = null;
        } else {
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
          this.prefetched.abortController.abort();
          if (this.prefetched.audio) {
            this.prefetched.audio.pause();
            this.prefetched.audio.onended = null;
            this.prefetched.audio.onerror = null;
          }
          if (this.prefetched.url) {
            URL.revokeObjectURL(this.prefetched.url);
          }
          this.prefetched = null;
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
        console.warn("[Azure TTS] retrying after error:", error);
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
    const res = await fetch("/api/tts/azure", {
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
      throw new Error(body.error || `Azure Speech request failed (${res.status})`);
    }

    const blob = await res.blob();
    if (blob.size === 0) {
      throw new Error("Azure returned an empty audio response");
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

      audio.onended = () => resolve();
      audio.onerror = () => {
        reject(new Error(`Azure audio playback failed (${mediaErrorName(audio.error?.code)})`));
      };
      audio.play().catch(reject);
    });
  }

  private cleanup(): void {
    this.abortController?.abort();
    this.abortController = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (this.prefetched) {
      this.prefetched.abortController.abort();
      if (this.prefetched.audio) {
        this.prefetched.audio.pause();
        this.prefetched.audio.onended = null;
        this.prefetched.audio.onerror = null;
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
