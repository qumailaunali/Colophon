import type { EpubSentence } from "./types";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE"]);

/**
 * Mutates `root` in place, wrapping every sentence of visible text in a
 * `<span data-sentence-index>` so the reader can highlight/click/select at
 * sentence granularity for TTS, search, and highlights. Splits per text
 * node — a sentence that spans an inline tag boundary (e.g. "This is
 * <em>bold</em> text.") becomes multiple indexed fragments rather than one,
 * which is an accepted simplification for a personal reader.
 */
export function wrapSentences(root: Element): EpubSentence[] {
  const sentences: EpubSentence[] = [];
  let counter = 0;
  const doc = root.ownerDocument;

  const segmenter: Intl.Segmenter | null =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "sentence" })
      : null;

  function splitIntoSentences(text: string): string[] {
    if (!text.trim()) return [];
    if (segmenter) {
      return Array.from(segmenter.segment(text), (s) => s.segment).filter((s) => s.trim());
    }
    const matches = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
    return matches ? matches.filter((s) => s.trim()) : [text];
  }

  function processNode(node: ChildNode) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text.trim()) return;

      const parts = splitIntoSentences(text);
      if (parts.length === 0) return;

      const frag = doc.createDocumentFragment();
      for (const part of parts) {
        const span = doc.createElement("span");
        span.className = "sentence";
        span.setAttribute("data-sentence-index", String(counter));
        span.textContent = part;
        sentences.push({ index: counter, text: part.trim() });
        counter++;
        frag.appendChild(span);
      }
      node.parentNode?.replaceChild(frag, node);
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return;
      Array.from(el.childNodes).forEach(processNode);
    }
  }

  Array.from(root.childNodes).forEach(processNode);
  return sentences;
}
