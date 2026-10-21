export interface TTSVoice {
  name: string;
  lang: string;
}

export interface TTSUtteranceOptions {
  rate: number; // 0.5 - 2
  pitch: number; // 0 - 2
  volume: number; // 0 - 1
  voiceName?: string | null;
}

export interface TTSSpeakCallbacks {
  onEnd: () => void;
  onError: (error: unknown) => void;
  /** "busy" while the provider waits out a rate limit before retrying the
   * same sentence; null once audio is ready again. */
  onStatus?: (status: "busy" | null) => void;
}

/**
 * Provider-agnostic read-aloud interface. WebSpeechProvider is the default
 * (free, browser-native) implementation. A premium provider (ElevenLabs,
 * OpenAI TTS) can later implement this same interface and be swapped in via
 * getTTSProvider() without any change to reader/control-bar UI code.
 */
export interface TTSProvider {
  listVoices(): Promise<TTSVoice[]>;
  speak(text: string, options: TTSUtteranceOptions, callbacks: TTSSpeakCallbacks): void;
  prefetch?(text: string, options: TTSUtteranceOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
  isSpeaking(): boolean;
  isPaused(): boolean;
}
