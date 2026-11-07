import { diffChars, diffWordsWithSpace } from "diff";

export type DiffLineType = "add" | "del" | "context";

// A run of unchanged lines the patch left out (git only sends a few lines of
// context around each change), shown as an expandable row.
export interface GapInfo {
  id: number;
  /** Hidden lines still not shown. */
  count: number;
  oldStart: number;
  newStart: number;
  /** A change precedes the gap, so lines can be revealed downward from it. */
  hasAbove: boolean;
  /** A change follows the gap, so lines can be revealed upward from it. */
  hasBelow: boolean;
}

// How many lines one click on a gap's step buttons reveals.
export const GAP_STEP = 20;

export interface DiffLine {
  type: DiffLineType;
  content: string;
  // Marks the placeholder for hidden lines (type is "context", content empty).
  gap?: GapInfo;
  // A context line the user expanded from a gap, not part of the patch.
  revealed?: boolean;
  // 1-based line numbers, present once a hunk header has been seen. A del has
  // only oldNo, an add only newNo, context both.
  oldNo?: number;
  newNo?: number;
  // Set by markMovedLines: this add/del has an identical counterpart elsewhere
  // in the file, so it was relocated rather than written or removed.
  moved?: boolean;
}

export interface WordSegment {
  value: string;
  changed: boolean;
  // A changed segment that is pure whitespace (reindent, trailing space) is
  // visually distinct from an actual content edit.
  whitespace: boolean;
}

// A single aligned row for split view: a context line occupies both sides,
// a replace pairs one del with one add at the same row index, and a pure
// add/del leaves the other side blank so the two panes stay in lockstep.
export interface DiffRow<T extends DiffLine = DiffLine> {
  old: T | null;
  new: T | null;
  /** Set on the placeholder row for hidden lines; old/new are null. */
  gap?: GapInfo;
  oldWords: WordSegment[] | null;
  newWords: WordSegment[] | null;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Hunk headers are consumed for their starting line numbers and not emitted;
// the jump in numbers between hunks shows where lines were skipped.
export function parseDiffLines(patch: string): DiffLine[] {
  const lines = patch.split("\n");
  const hunkStart = lines.findIndex((line) => line.startsWith("@@"));
  const body = hunkStart === -1 ? lines : lines.slice(hunkStart);
  const out: DiffLine[] = [];
  let oldNo: number | null = null;
  let newNo: number | null = null;
  for (const line of body) {
    if (line.length === 0) continue;
    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      continue;
    }
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) {
      out.push({ type: "add", content: line.slice(1), ...(newNo !== null ? { newNo: newNo++ } : {}) });
    } else if (line.startsWith("-")) {
      out.push({ type: "del", content: line.slice(1), ...(oldNo !== null ? { oldNo: oldNo++ } : {}) });
    } else {
      out.push({
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        ...(oldNo !== null && newNo !== null ? { oldNo: oldNo++, newNo: newNo++ } : {}),
      });
    }
  }
  return out;
}

export function countChangedChars(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") added += line.content.length;
    else if (line.type === "del") removed += line.content.length;
  }
  return { added, removed };
}

// Generic over T so callers passing a subtype (e.g. RenderedLine, which adds
// an `html` field) get that subtype back, not the widened DiffLine base type.
export function oldPaneLines<T extends DiffLine>(lines: T[]): T[] {
  return lines.filter((line) => line.type !== "add");
}

export function newPaneLines<T extends DiffLine>(lines: T[]): T[] {
  return lines.filter((line) => line.type !== "del");
}

// Below this length, a word-level diff tends to highlight almost the whole
// line (e.g. a one-character rename); a char-level diff pinpoints the exact
// edit instead.
const CHAR_DIFF_MAX_LENGTH = 30;

export function isWhitespaceOnlyChange(oldContent: string, newContent: string): boolean {
  return oldContent !== newContent && oldContent.replace(/\s+/g, "") === newContent.replace(/\s+/g, "");
}

function wordDiff(oldContent: string, newContent: string): { oldWords: WordSegment[]; newWords: WordSegment[] } {
  const useChars = Math.max(oldContent.length, newContent.length) <= CHAR_DIFF_MAX_LENGTH;
  const parts = useChars ? diffChars(oldContent, newContent) : diffWordsWithSpace(oldContent, newContent);
  const oldWords: WordSegment[] = [];
  const newWords: WordSegment[] = [];
  for (const part of parts) {
    const whitespace = part.value.trim().length === 0;
    if (part.added) {
      newWords.push({ value: part.value, changed: true, whitespace });
    } else if (part.removed) {
      oldWords.push({ value: part.value, changed: true, whitespace });
    } else {
      oldWords.push({ value: part.value, changed: false, whitespace: false });
      newWords.push({ value: part.value, changed: false, whitespace: false });
    }
  }
  return { oldWords, newWords };
}

// Flattens aligned rows back into the original del-then-add order, carrying
// each line's word-diff segments along for the unified (single-column) view.
export function flattenDiffRows<T extends DiffLine>(
  rows: DiffRow<T>[]
): { line: T; words: WordSegment[] | null }[] {
  const out: { line: T; words: WordSegment[] | null }[] = [];
  for (const row of rows) {
    if (row.old && row.new && row.old === row.new) {
      out.push({ line: row.old, words: null });
      continue;
    }
    if (row.old) out.push({ line: row.old, words: row.oldWords });
    if (row.new) out.push({ line: row.new, words: row.newWords });
  }
  return out;
}

// Groups a flat diff into aligned rows for the split view: consecutive runs
// of del lines followed by add lines (a "replace" block) are paired up by
// index so old[i]/new[i] land on the same row, instead of each pane being
// filtered independently and drifting out of sync in height.
export function buildDiffRows<T extends DiffLine>(lines: T[]): DiffRow<T>[] {
  const rows: DiffRow<T>[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.gap) {
      rows.push({ old: null, new: null, oldWords: null, newWords: null, gap: line.gap });
      i++;
      continue;
    }
    if (line.type === "context") {
      rows.push({ old: line, new: line, oldWords: null, newWords: null });
      i++;
      continue;
    }
    const dels: T[] = [];
    while (i < lines.length && lines[i].type === "del") {
      dels.push(lines[i]);
      i++;
    }
    const adds: T[] = [];
    while (i < lines.length && lines[i].type === "add") {
      adds.push(lines[i]);
      i++;
    }
    const pairCount = Math.max(dels.length, adds.length);
    for (let j = 0; j < pairCount; j++) {
      const oldLine = dels[j] ?? null;
      const newLine = adds[j] ?? null;
      const words =
        oldLine && newLine ? wordDiff(oldLine.content, newLine.content) : { oldWords: null, newWords: null };
      rows.push({ old: oldLine, new: newLine, oldWords: words.oldWords, newWords: words.newWords });
    }
  }
  return rows;
}

function isContextRow<T extends DiffLine>(row: DiffRow<T>): boolean {
  return row.old !== null && row.new !== null && row.old === row.new;
}

export type DisplayRow<T extends DiffLine> =
  | { kind: "row"; row: DiffRow<T> }
  | { kind: "collapsed"; rows: DiffRow<T>[] };

// Folds a run of unchanged context rows longer than `threshold` down to its
// first/last `edge` rows plus a single collapsed placeholder, so a diff with
// long stretches of unchanged code doesn't render every one of those lines.
export function collapseContextRows<T extends DiffLine>(
  rows: DiffRow<T>[],
  edge = 3,
  threshold = 8
): DisplayRow<T>[] {
  const out: DisplayRow<T>[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!isContextRow(rows[i])) {
      out.push({ kind: "row", row: rows[i] });
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && isContextRow(rows[j])) j++;
    const run = rows.slice(i, j);
    // Lines the user just expanded must stay visible, not fold back up.
    if (run.length <= threshold || run.some((r) => r.old?.revealed)) {
      for (const row of run) out.push({ kind: "row", row });
    } else {
      for (const row of run.slice(0, edge)) out.push({ kind: "row", row });
      out.push({ kind: "collapsed", rows: run.slice(edge, run.length - edge) });
      for (const row of run.slice(run.length - edge)) out.push({ kind: "row", row });
    }
    i = j;
  }
  return out;
}

// Row indices where a contiguous block of changes starts, for "jump to next
// change" keyboard navigation.
export function changeHunkStarts<T extends DiffLine>(rows: DiffRow<T>[]): number[] {
  const starts: number[] = [];
  let inHunk = false;
  rows.forEach((row, i) => {
    if (row.gap) {
      inHunk = false;
      return;
    }
    const changed = !isContextRow(row);
    if (changed && !inHunk) starts.push(i);
    inHunk = changed;
  });
  return starts;
}

// Patches past either limit are not parsed or highlighted until the user
// asks for them; a single huge file would otherwise freeze the view.
export const HUGE_PATCH_BYTES = 200_000;
export const HUGE_PATCH_LINES = 5000;

export function patchLineCount(patch: string): number {
  if (patch.length === 0) return 0;
  let n = 1;
  for (let i = patch.indexOf("\n"); i !== -1; i = patch.indexOf("\n", i + 1)) n++;
  return n;
}

export function isHugePatch(patch: string): boolean {
  return patch.length > HUGE_PATCH_BYTES || patchLineCount(patch) > HUGE_PATCH_LINES;
}

// Lines shorter than this (after trimming) or made only of punctuation such
// as `}` / `);` match everywhere, so treating them as moved is just noise.
const MIN_MOVED_LENGTH = 6;

function isTrivialForMove(trimmed: string): boolean {
  return trimmed.length < MIN_MOVED_LENGTH || !/[A-Za-z0-9]/.test(trimmed);
}

// Flags del/add lines whose trimmed content was deleted in one change block
// and added in a different one. Matches inside the same block are in-place
// edits (e.g. a reindent), not moves, so they are left alone. Returns new
// line objects with `moved` set; the input is untouched.
export function markMovedLines<T extends DiffLine>(lines: T[]): T[] {
  const blockOf: number[] = [];
  let block = -1;
  let inChange = false;
  lines.forEach((line, i) => {
    const changed = line.type !== "context";
    if (changed && !inChange) block++;
    inChange = changed;
    blockOf[i] = changed ? block : -1;
  });

  const delBlocks = new Map<string, Set<number>>();
  const addBlocks = new Map<string, Set<number>>();
  lines.forEach((line, i) => {
    if (line.type === "context") return;
    const key = line.content.trim();
    if (isTrivialForMove(key)) return;
    const map = line.type === "del" ? delBlocks : addBlocks;
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(blockOf[i]);
  });

  const hasOtherBlock = (set: Set<number> | undefined, b: number) => {
    if (!set) return false;
    for (const x of set) if (x !== b) return true;
    return false;
  };

  return lines.map((line, i) => {
    if (line.type === "context") return line;
    const key = line.content.trim();
    if (isTrivialForMove(key)) return line;
    const counterpart = line.type === "del" ? addBlocks.get(key) : delBlocks.get(key);
    return hasOtherBlock(counterpart, blockOf[i]) ? { ...line, moved: true } : line;
  });
}

// The +/- text of the contiguous change block starting at `rows[start]`,
// for the per-hunk copy button.
export function hunkText<T extends DiffLine>(rows: DiffRow<T>[], start: number): string {
  const dels: string[] = [];
  const adds: string[] = [];
  for (let i = start; i < rows.length && !isContextRow(rows[i]) && !rows[i].gap; i++) {
    if (rows[i].old) dels.push("-" + rows[i].old!.content);
    if (rows[i].new) adds.push("+" + rows[i].new!.content);
  }
  return [...dels, ...adds].join("\n");
}

/** A file's lines, without the empty piece a trailing newline leaves behind. */
export function splitFileLines(content: string): string[] {
  const parts = content.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

export interface RevealedGap {
  /** Lines shown next to the previous change. */
  top: number;
  /** Lines shown next to the following change. */
  bottom: number;
}

/**
 * Inserts a placeholder line wherever the patch skipped unchanged lines (before
 * the first change, between changes, after the last one), using the file's
 * `newLines` as the source of those lines. `revealed` says how much of each
 * gap, by id, the user has expanded; those lines come out as real context
 * lines built with `toLine`. Patches without line numbers are returned as is.
 */
export function insertGaps<T extends DiffLine>(
  lines: T[],
  newLines: string[],
  revealed: Record<number, RevealedGap>,
  toLine: (line: DiffLine) => T
): T[] {
  if (lines.length === 0 || lines.some((l) => l.oldNo === undefined && l.newNo === undefined)) return lines;

  const out: T[] = [];
  let oldPos = 1;
  let newPos = 1;
  let nextId = 0;

  const emitGap = (count: number, hasAbove: boolean, hasBelow: boolean) => {
    const id = nextId++;
    const oldStart = oldPos;
    const newStart = newPos;
    // Content we don't have (stale or short file contents): show nothing rather than guess.
    if (count <= 0 || newStart + count - 1 > newLines.length) return;
    const r = revealed[id] ?? { top: 0, bottom: 0 };
    const top = Math.min(r.top, count);
    const bottom = Math.min(r.bottom, count - top);
    const lineAt = (offset: number): T =>
      ({
        ...toLine({
          type: "context",
          content: newLines[newStart + offset - 1],
          oldNo: oldStart + offset,
          newNo: newStart + offset,
        }),
        revealed: true,
      }) as T;
    for (let k = 0; k < top; k++) out.push(lineAt(k));
    const remaining = count - top - bottom;
    if (remaining > 0) {
      out.push(
        toLine({
          type: "context",
          content: "",
          gap: {
            id,
            count: remaining,
            oldStart: oldStart + top,
            newStart: newStart + top,
            hasAbove,
            hasBelow,
          },
        })
      );
    }
    for (let k = count - bottom; k < count; k++) out.push(lineAt(k));
  };

  lines.forEach((line, index) => {
    const gap = line.oldNo !== undefined ? line.oldNo - oldPos : (line.newNo as number) - newPos;
    if (gap > 0) {
      emitGap(gap, index > 0, true);
      oldPos += gap;
      newPos += gap;
    }
    out.push(line);
    if (line.oldNo !== undefined) oldPos = line.oldNo + 1;
    if (line.newNo !== undefined) newPos = line.newNo + 1;
  });

  emitGap(newLines.length - (newPos - 1), true, false);
  return out;
}
