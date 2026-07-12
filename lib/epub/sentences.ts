import type { EpubSentence } from "./types";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE"]);

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER",
  "DT", "DD", "PRE", "TD", "TH", "CAPTION", "HR", "UL", "OL", "TABLE",
  "TR", "THEAD", "TBODY", "TFOOT", "FORM", "FIELDSET", "LEGEND"
]);

/**
 * Mutates `root` in place, wrapping every sentence of visible text in a
 * `<span data-sentence-index>` so the reader can highlight/click/select at
 * sentence granularity for TTS, search, and highlights.
 *
 * It groups inline text nodes across formatting tag boundaries within blocks,
 * splits them precisely at sentence boundaries, and wraps them in spans sharing
 * the same `data-sentence-index`. This avoids splitting single sentences into
 * multiple utterances when styled tags (e.g. <em>, <strong>, <a>) exist.
 */
export function wrapSentences(root: Element): EpubSentence[] {
  const sentences: EpubSentence[] = [];
  let counter = 0;
  const doc = root.ownerDocument;

  const segmenter: Intl.Segmenter | null =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "sentence" })
      : null;

  function getSegments(text: string): { index: number; segment: string }[] {
    if (segmenter) {
      return Array.from(segmenter.segment(text)).map((s) => ({
        index: s.index,
        segment: s.segment,
      }));
    }
    // Fallback Regex segmenter
    const segments: { index: number; segment: string }[] = [];
    const regex = /[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      segments.push({
        index: match.index,
        segment: match[0],
      });
    }
    if (segments.length === 0 && text) {
      segments.push({ index: 0, segment: text });
    }
    return segments;
  }

  let currentBlockTextNodes: Text[] = [];

  function flush() {
    if (currentBlockTextNodes.length === 0) return;
    const textNodes = [...currentBlockTextNodes];
    currentBlockTextNodes = [];

    const fullText = textNodes.map((node) => node.textContent ?? "").join("");
    if (!fullText.trim()) return;

    const segments = getSegments(fullText);
    if (segments.length === 0) return;

    // Collect all boundaries where we need to split text nodes
    const boundaries = new Set<number>();
    for (const seg of segments) {
      boundaries.add(seg.index);
      boundaries.add(seg.index + seg.segment.length);
    }

    const sortedBoundaries = Array.from(boundaries).sort((a, b) => b - a);

    // Split text nodes at boundaries (right-to-left to keep offsets valid)
    for (const offset of sortedBoundaries) {
      let currentLen = 0;
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        const len = node.textContent?.length ?? 0;
        if (currentLen < offset && offset < currentLen + len) {
          const splitOffset = offset - currentLen;
          const newNode = node.splitText(splitOffset);
          textNodes.splice(i + 1, 0, newNode);
          break;
        }
        currentLen += len;
      }
    }

    // Map segments to sentence indices
    const segmentIndexToSentenceIndex: Record<number, number> = {};
    segments.forEach((seg, index) => {
      const trimmed = seg.segment.trim();
      if (trimmed) {
        segmentIndexToSentenceIndex[index] = counter;
        sentences.push({
          index: counter,
          text: trimmed,
        });
        counter++;
      }
    });

    // Wrap nodes in spans
    let currentLen = 0;
    for (const node of textNodes) {
      const len = node.textContent?.length ?? 0;
      const nodeStart = currentLen;
      const nodeEnd = currentLen + len;
      currentLen = nodeEnd;

      if (len === 0) continue;

      const matchingSegmentIndex = segments.findIndex((seg) => {
        const segStart = seg.index;
        const segEnd = seg.index + seg.segment.length;
        return nodeStart >= segStart && nodeEnd <= segEnd;
      });

      if (matchingSegmentIndex !== -1) {
        const sentenceIndex = segmentIndexToSentenceIndex[matchingSegmentIndex];
        if (sentenceIndex !== undefined && node.parentNode) {
          const span = doc.createElement("span");
          span.className = "sentence";
          span.setAttribute("data-sentence-index", String(sentenceIndex));
          node.parentNode.replaceChild(span, node);
          span.appendChild(node);
        }
      }
    }
  }

  function traverse(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      currentBlockTextNodes.push(node as Text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return;

      const isBlock = BLOCK_TAGS.has(el.tagName) || el.tagName === "BR";
      if (isBlock) {
        flush();
      }

      for (const child of Array.from(el.childNodes)) {
        traverse(child);
      }

      if (isBlock) {
        flush();
      }
    }
  }

  traverse(root);
  flush();

  return sentences;
}
