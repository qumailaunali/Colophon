import type { TTSProvider, TTSSpeakCallbacks, TTSUtteranceOptions, TTSVoice } from "./TTSProvider";

export class WebSpeechProvider implements TTSProvider {
  private activeUtterance: SpeechSynthesisUtterance | null = null;

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

  speak(text: string, options: TTSUtteranceOptions, callbacks: TTSSpeakCallbacks): void {
    const synth = window.speechSynthesis;
    if (this.activeUtterance) {
      this.activeUtterance.onend = null;
      this.activeUtterance.onerror = null;
      this.activeUtterance.onboundary = null;
    }
    synth.cancel();

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

    utterance.onboundary = (event) => {
      if (wasInterrupted || this.activeUtterance !== utterance) return;
      if (event.name === "word" && callbacks.onBoundary) {
        callbacks.onBoundary(event.charIndex, event.charLength || 0);
      }
    };

    // A brief timeout gives Chrome's background process time to fully resolve the cancel() event
    // before we push the new utterance into the playback queue.
    setTimeout(() => {
      if (this.activeUtterance !== utterance) return;
      synth.speak(utterance);
    }, 120);
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
      this.activeUtterance.onboundary = null;
      this.activeUtterance = null;
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
