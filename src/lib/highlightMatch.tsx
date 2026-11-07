import type { ReactNode } from "react";

export interface TextPart {
  text: string;
  match: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Splits text into matched/unmatched parts for a case-insensitive literal query.
export function splitMatches(text: string, query: string): TextPart[] {
  const q = query.trim();
  if (!text) return [];
  if (!q) return [{ text, match: false }];
  const re = new RegExp(escapeRegExp(q), "gi");
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    parts.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

export function highlightMatch(text: string, query: string): ReactNode {
  const parts = splitMatches(text, query);
  if (parts.length === 0) return text;
  return parts.map((p, i) =>
    p.match ? (
      <mark key={i} className="bg-accent-soft text-accent rounded-sm">
        {p.text}
      </mark>
    ) : (
      p.text
    )
  );
}
