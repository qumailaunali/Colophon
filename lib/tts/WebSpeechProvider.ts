import type { TTSProvider, TTSSpeakCallbacks, TTSUtteranceOptions, TTSVoice } from "./TTSProvider";

export class WebSpeechProvider implements TTSProvider {
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
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate;
    utterance.pitch = options.pitch;
    utterance.volume = options.volume;

    if (options.voiceName) {
      const voice = synth.getVoices().find((v) => v.name === options.voiceName);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => callbacks.onEnd();
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") return;
      callbacks.onError(event.error);
    };

    utterance.onboundary = (event) => {
      if (event.name === "word" && callbacks.onBoundary) {
        callbacks.onBoundary(event.charIndex, event.charLength || 0);
      }
    };

    synth.speak(utterance);
  }

  pause(): void {
    window.speechSynthesis.pause();
  }

  resume(): void {
    window.speechSynthesis.resume();
  }

  stop(): void {
    window.speechSynthesis.cancel();
  }

  isSpeaking(): boolean {
    return window.speechSynthesis.speaking;
  }

  isPaused(): boolean {
    return window.speechSynthesis.paused;
  }
}
