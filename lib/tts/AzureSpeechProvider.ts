import type { TTSProvider, TTSSpeakCallbacks, TTSUtteranceOptions, TTSVoice } from "./TTSProvider";

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

  speak(text: string, options: TTSUtteranceOptions, callbacks: TTSSpeakCallbacks): void {
    this.cleanup();

    const controller = new AbortController();
    this.abortController = controller;

    (async () => {
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
      const url = URL.createObjectURL(blob);
      this.objectUrl = url;

      const audio = new Audio(url);
      audio.playbackRate = options.rate;
      audio.volume = Math.min(1, Math.max(0, options.volume));
      this.audio = audio;
      audio.onended = () => callbacks.onEnd();
      audio.onerror = () => {
        const code = audio.error?.code;
        const codeName =
          code === 1
            ? "ABORTED"
            : code === 2
              ? "NETWORK"
              : code === 3
                ? "DECODE"
                : code === 4
                  ? "SRC_NOT_SUPPORTED"
                  : "UNKNOWN";
        callbacks.onError(new Error(`Azure audio playback failed (${codeName})`));
      };
      await audio.play();
    })().catch((error) => {
      if (controller.signal.aborted) return;
      callbacks.onError(error);
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
