export type DiffLineType = "add" | "del" | "context";

export interface DiffLine {
  type: DiffLineType;
  content: string;
}

export function parseDiffLines(patch: string): DiffLine[] {
  return patch
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith("+")) return { type: "add" as const, content: line.slice(1) };
      if (line.startsWith("-")) return { type: "del" as const, content: line.slice(1) };
      return { type: "context" as const, content: line.startsWith(" ") ? line.slice(1) : line };
    });
}

// Generic over T so callers passing a subtype (e.g. RenderedLine, which adds
// an `html` field) get that subtype back, not the widened DiffLine base type.
export function oldPaneLines<T extends DiffLine>(lines: T[]): T[] {
  return lines.filter((line) => line.type !== "add");
}

export function newPaneLines<T extends DiffLine>(lines: T[]): T[] {
  return lines.filter((line) => line.type !== "del");
}
