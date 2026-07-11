import type { HighlightRow } from "@/lib/supabase/types";

export function buildHighlightsMarkdown(bookTitle: string, highlights: HighlightRow[]): string {
  const lines = [`# Highlights — ${bookTitle}`, ""];

  const sorted = [...highlights].sort(
    (a, b) => a.spine_index - b.spine_index || a.sentence_index_start - b.sentence_index_start
  );

  for (const h of sorted) {
    lines.push(`## Chapter ${h.spine_index + 1}`);
    lines.push(`> ${h.text_snippet}`);
    if (h.note) lines.push(`\n**Note:** ${h.note}`);
    lines.push(`\n_${h.color} · ${new Date(h.created_at).toLocaleDateString()}_`);
    lines.push("");
  }

  return lines.join("\n");
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
