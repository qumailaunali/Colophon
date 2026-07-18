import type { TTSProvider } from "./TTSProvider";
import { WebSpeechProvider } from "./WebSpeechProvider";
import { AzureSpeechProvider } from "./AzureSpeechProvider";
import { EdgeSpeechProvider } from "./EdgeSpeechProvider";
import type { TtsProviderKind } from "@/lib/supabase/types";

const instances: Partial<Record<TtsProviderKind, TTSProvider>> = {};

/**
 * Swapping in a premium provider is just adding a class that implements
 * TTSProvider and a case here — no reader/control-bar UI code changes.
 */
export function getTTSProvider(kind: TtsProviderKind = "webspeech"): TTSProvider {
  const existing = instances[kind];
  if (existing) return existing;

  let created: TTSProvider;
  if (kind === "azure") {
    created = new AzureSpeechProvider();
  } else if (kind === "edge") {
    created = new EdgeSpeechProvider();
  } else {
    created = new WebSpeechProvider();
  }

  instances[kind] = created;
  return created;
}
