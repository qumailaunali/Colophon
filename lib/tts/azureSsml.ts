export const DEFAULT_AZURE_VOICE = "en-US-JennyNeural";

function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Many Azure neural voices ignore or only partly support SSML <prosody>
 * rate/volume adjustments, so speed and volume are applied reliably on the
 * client instead via the <audio> element's playbackRate/volume. Only pitch
 * has no browser-native equivalent, so it's still requested here via SSML
 * as a best-effort (honored on voices that support it, ignored otherwise).
 */
export function buildSsml(text: string, voiceName: string, pitch: number): string {
  const lang = voiceName.split("-").slice(0, 2).join("-") || "en-US";
  const pitchDelta = Math.round((pitch - 1) * 100);
  const pitchPercent = `${pitchDelta >= 0 ? "+" : ""}${pitchDelta}%`;

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">
  <voice name="${voiceName}">
    <prosody pitch="${pitchPercent}">${escapeSsml(text)}</prosody>
  </voice>
</speak>`;
}
