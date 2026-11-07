export interface AnsiSegment { text: string; className: string }

const COLORS: Record<number, string> = {
  31: "text-danger", 32: "text-success", 33: "text-merged", 34: "text-accent", 35: "text-merged", 36: "text-accent",
  90: "text-text-muted",
};

// Handles SGR color/bold/reset; every other or malformed escape sequence is dropped.
export function parseAnsi(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  const re = /\u001b\[([0-9;]*)m|\u001b\[[0-9;]*[A-Za-z]?|\u001b/g;
  let color = "";
  let bold = false;
  let last = 0;
  const push = (text: string) => {
    if (text) segments.push({ text, className: [color, bold && "font-bold"].filter(Boolean).join(" ") });
  };
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    push(line.slice(last, match.index));
    last = re.lastIndex;
    if (match[1] === undefined) continue;
    const codes = match[1].split(";").map((c) => Number(c || 0));
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 38 || code === 48) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
      else if (code === 0) { color = ""; bold = false; }
      else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = "";
      else if (COLORS[code]) color = COLORS[code];
    }
  }
  push(line.slice(last));
  // Merge adjacent segments with identical styling; an empty line still yields one empty segment.
  const merged = segments.reduce<AnsiSegment[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.className === s.className) prev.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
  return merged.length ? merged : [{ text: "", className: "" }];
}
