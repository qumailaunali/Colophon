import type { TTSProvider, TTSSpeakCallbacks, TTSUtteranceOptions, TTSVoice } from "./TTSProvider";

interface PrefetchedUtterance {
  text: string;
  options: TTSUtteranceOptions;
  utterance: SpeechSynthesisUtterance;
  finished: boolean;
  error: unknown | null;
}

export class WebSpeechProvider implements TTSProvider {
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private prefetched: PrefetchedUtterance | null = null;

  async listVoices(): Promise<TTSVoice[]> {
    const synth = window.speechSynthesis;
    const toVoices = (voices: SpeechSynthesisVoice[]) =>
      voices
        .filter((v) => v.lang.toLowerCase().startsWith("en"))
        .map((v) => ({ name: v.name, lang: v.lang }));

    const existing = synth.getVoices();
    if (existing.length > 0) return toVoices(existing);

    return new Promise((resolve) => {
      const handler = () => {
        synth.removeEventListener("voiceschanged", handler);
        resolve(toVoices(synth.getVoices()));
      };
      synth.addEventListener("voiceschanged", handler);
      setTimeout(() => resolve(toVoices(synth.getVoices())), 1000);
    });
  }

  prefetch(text: string, options: TTSUtteranceOptions): void {
    const synth = window.speechSynthesis;

    // If already prefetching the exact same thing, do nothing
    if (
      this.prefetched &&
      this.prefetched.text === text &&
      this.prefetched.options.voiceName === options.voiceName &&
      this.prefetched.options.rate === options.rate
    ) {
      return;
    }

    // Cancel any existing prefetch
    if (this.prefetched) {
      this.prefetched.utterance.onend = null;
      this.prefetched.utterance.onerror = null;
      this.prefetched = null;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate;
    utterance.pitch = options.pitch;
    utterance.volume = options.volume;

    if (options.voiceName) {
      const voice = synth.getVoices().find((v) => v.name === options.voiceName);
      if (voice) utterance.voice = voice;
    }

    const pref: PrefetchedUtterance = {
      text,
      options,
      utterance,
      finished: false,
      error: null,
    };

    utterance.onend = () => {
      pref.finished = true;
    };
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") {
        return;
      }
      pref.error = event.error;
    };

    this.prefetched = pref;

    // Queue it in the browser's synthesis engine natively
    synth.speak(utterance);
  }

  speak(text: string, options: TTSUtteranceOptions, callbacks: TTSSpeakCallbacks): void {
    const synth = window.speechSynthesis;

    // Clean up active utterance listeners
    if (this.activeUtterance) {
      this.activeUtterance.onend = null;
      this.activeUtterance.onerror = null;
    }

    // Check if we have a matching prefetched utterance
    if (
      this.prefetched &&
      this.prefetched.text === text &&
      this.prefetched.options.voiceName === options.voiceName &&
      this.prefetched.options.rate === options.rate
    ) {
      const match = this.prefetched;
      this.prefetched = null;
      this.activeUtterance = match.utterance;

      if (match.finished) {
        callbacks.onEnd();
        return;
      }
      if (match.error) {
        callbacks.onError(match.error);
        return;
      }

      match.utterance.onend = () => {
        if (this.activeUtterance !== match.utterance) return;
        callbacks.onEnd();
      };
      match.utterance.onerror = (event) => {
        if (this.activeUtterance !== match.utterance) return;
        if (event.error === "interrupted" || event.error === "canceled") return;
        callbacks.onError(event.error);
      };
      return;
    }

    // No prefetch match. Clear any existing prefetch and current playbacks.
    if (this.prefetched) {
      this.prefetched.utterance.onend = null;
      this.prefetched.utterance.onerror = null;
      this.prefetched = null;
    }

    const wasSpeaking = synth.speaking;
    if (wasSpeaking) {
      synth.cancel();
    }

    this.activeUtterance = new SpeechSynthesisUtterance(text);
    const utterance = this.activeUtterance;
    utterance.rate = options.rate;
    utterance.pitch = options.pitch;
    utterance.volume = options.volume;

    if (options.voiceName) {
      const voice = synth.getVoices().find((v) => v.name === options.voiceName);
      if (voice) utterance.voice = voice;
    }

    let wasInterrupted = false;

    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") {
        wasInterrupted = true;
        return;
      }
      callbacks.onError(event.error);
    };

    utterance.onend = () => {
      if (wasInterrupted || this.activeUtterance !== utterance) return;
      callbacks.onEnd();
    };

    if (wasSpeaking) {
      // A brief timeout gives Chrome's background process time to fully resolve the cancel() event
      // before we push the new utterance into the playback queue.
      setTimeout(() => {
        if (this.activeUtterance !== utterance) return;
        synth.speak(utterance);
      }, 120);
    } else {
      synth.speak(utterance);
    }
  }

  pause(): void {
    window.speechSynthesis.pause();
  }

  resume(): void {
    window.speechSynthesis.resume();
  }

  stop(): void {
    if (this.activeUtterance) {
      this.activeUtterance.onend = null;
      this.activeUtterance.onerror = null;
      this.activeUtterance = null;
    }
    if (this.prefetched) {
      this.prefetched.utterance.onend = null;
      this.prefetched.utterance.onerror = null;
      this.prefetched = null;
    }
    window.speechSynthesis.cancel();
  }

  isSpeaking(): boolean {
    return window.speechSynthesis.speaking;
  }

  isPaused(): boolean {
    return window.speechSynthesis.paused;
  }
}
