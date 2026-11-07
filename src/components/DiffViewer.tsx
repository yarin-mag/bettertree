import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Copy, MoreHorizontal } from "lucide-react";
import { type FileDiff } from "../lib/tauri";
import {
  parseDiffLines,
  countChangedChars,
  buildDiffRows,
  flattenDiffRows,
  collapseContextRows,
  changeHunkStarts,
  isWhitespaceOnlyChange,
  markMovedLines,
  hunkText,
  insertGaps,
  splitFileLines,
  GAP_STEP,
  type GapInfo,
  type RevealedGap,
  isHugePatch,
  patchLineCount,
  type DiffLine,
  type DiffLineType,
  type DiffRow,
  type WordSegment,
} from "../lib/diffLines";
import { highlightLine } from "../lib/highlight";
import { useThemeStore } from "../store/themeStore";
import { useDiffViewStore } from "../store/diffViewStore";
import { diffViewCssVars } from "../lib/themes";
import { copyText } from "../lib/clipboard";
import { toast } from "../store/toastStore";

// Offscreen files render a placeholder until within this distance of the
// viewport, and never before they are expanded.
const LAZY_ROOT_MARGIN = "800px 0px";
// Rough row height, used to size placeholders for files not yet rendered.
const ESTIMATED_ROW_HEIGHT = 20;

interface RenderedLine extends DiffLine {
  html: string | null;
}

function lineTint(type: DiffLineType): string {
  if (type === "add") return "bg-[var(--diff-add-bg)]";
  if (type === "del") return "bg-[var(--diff-del-bg)]";
  return "";
}

// Moved lines get a neutral tint instead of add/del colors so real changes
// stand out from code that was only relocated.
function movedTint(): string {
  return "bg-elevated";
}

function wordTint(type: DiffLineType): string {
  return type === "add"
    ? "bg-[var(--diff-add-word)]"
    : "bg-[var(--diff-del-word)]";
}

function copyLineOnClick(content: string) {
  const selection = window.getSelection();
  if (selection && selection.toString().length > 0) return;
  navigator.clipboard.writeText(content).catch(() => {});
}

function LineNo({ n }: { n?: number }) {
  return (
    <span className="w-9 shrink-0 pr-2 text-right text-text-muted opacity-60 select-none [font-variant-numeric:tabular-nums]">
      {n ?? ""}
    </span>
  );
}

function DiffLineRow({
  line,
  words,
  muted,
  hunkStart,
  gutter,
  onCopyHunk,
  wrap = true,
}: {
  gutter: "both" | "old" | "new";
  line: RenderedLine;
  words?: WordSegment[] | null;
  muted?: boolean;
  hunkStart?: boolean;
  onCopyHunk?: () => void;
  wrap?: boolean;
}) {
  // Wrapped text must be allowed to shrink inside the flex row; unwrapped text
  // stays on one line and the container scrolls.
  const textClass = wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere] min-w-0 flex-1" : "whitespace-pre";
  const marker = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  const moved = !!line.moved;
  return (
    <div
      data-hunk={hunkStart ? "true" : undefined}
      onClick={() => copyLineOnClick(line.content)}
      className={`group relative flex font-mono text-sm px-2 cursor-pointer hover:brightness-95 transition-[filter] duration-100 ${muted ? "" : moved ? movedTint() : lineTint(line.type)}`}
      title="Click to copy line"
    >
      {gutter !== "new" && <LineNo n={line.oldNo} />}
      {gutter !== "old" && <LineNo n={line.newNo} />}
      <span className="w-4 shrink-0 text-text-muted select-none">{marker}</span>
      {!muted && !moved && words ? (
        <span className={`text-text-primary ${textClass}`}>
          {words.map((segment, i) =>
            segment.changed ? (
              <mark
                key={i}
                className={`text-inherit rounded-sm ${
                  segment.whitespace
                    ? "underline decoration-dotted decoration-text-muted bg-transparent"
                    : wordTint(line.type)
                }`}
              >
                {segment.value}
              </mark>
            ) : (
              <span key={i}>{segment.value}</span>
            ),
          )}
        </span>
      ) : line.html ? (
        <span
          className={`shiki-line ${wrap ? "shiki-wrap min-w-0 flex-1" : ""}`}
          dangerouslySetInnerHTML={{ __html: line.html }}
        />
      ) : (
        <span className={`text-text-primary ${textClass}`}>{line.content}</span>
      )}
      {moved && (
        <span
          className="ml-2 self-center rounded-sm border border-border-subtle px-1 text-[10px] leading-tight text-text-muted select-none"
          title="This line was moved within the file"
        >
          moved
        </span>
      )}
      {hunkStart && onCopyHunk && (
        <button
          className="absolute right-1 top-0 hidden group-hover:flex items-center gap-1 rounded bg-elevated px-1 text-xs text-text-muted hover:text-text-primary"
          title="Copy hunk"
          aria-label="Copy hunk"
          onClick={(e) => {
            e.stopPropagation();
            onCopyHunk();
          }}
        >
          <Copy size={10} />
        </button>
      )}
    </div>
  );
}

// Keeps the opposite pane's row the same height when a line has no
// counterpart on this side (a pure add or pure del), so paired rows
// stay aligned across both columns.
function BlankDiffRow({ gutter }: { gutter: "both" | "old" | "new" }) {
  return (
    <div className="flex font-mono text-sm px-2">
      <LineNo />
      {gutter === "both" && <LineNo />}
      <span className="w-4 shrink-0 select-none">&nbsp;</span>
      <span className="whitespace-pre">&nbsp;</span>
    </div>
  );
}

function CollapsedRow({
  count,
  onExpand,
}: {
  count: number;
  onExpand: () => void;
}) {
  return (
    <button
      onClick={onExpand}
      className="w-full flex items-center justify-center gap-1 font-mono text-xs text-text-muted bg-elevated hover:bg-hover py-0.5"
    >
      <MoreHorizontal size={12} /> Show {count} unchanged line
      {count === 1 ? "" : "s"}
    </button>
  );
}

type GapAction = "top" | "bottom" | "all";

// Unchanged lines the patch left out: step down from the previous change, step
// up from the next one, or show everything.
function GapRow({ gap, onExpand }: { gap: GapInfo; onExpand: (id: number, action: GapAction) => void }) {
  const stepped = gap.count > GAP_STEP;
  const button =
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-hover hover:text-text-primary";
  return (
    <div
      data-testid="diff-gap"
      className="flex items-center justify-center gap-2 font-mono text-xs text-text-muted bg-elevated py-0.5"
    >
      {stepped && gap.hasAbove && (
        <button
          className={button}
          aria-label={`Show next ${GAP_STEP} lines`}
          title={`Show the next ${GAP_STEP} lines after the change above`}
          onClick={() => onExpand(gap.id, "top")}
        >
          <ChevronDown size={12} /> {GAP_STEP}
        </button>
      )}
      <button
        className={button}
        aria-label={`Show all ${gap.count} hidden lines`}
        onClick={() => onExpand(gap.id, "all")}
      >
        <MoreHorizontal size={12} /> {gap.count} hidden line{gap.count === 1 ? "" : "s"}
      </button>
      {stepped && gap.hasBelow && (
        <button
          className={button}
          aria-label={`Show previous ${GAP_STEP} lines`}
          title={`Show the ${GAP_STEP} lines before the change below`}
          onClick={() => onExpand(gap.id, "bottom")}
        >
          <ChevronUp size={12} /> {GAP_STEP}
        </button>
      )}
    </div>
  );
}

function useNearViewport(ref: React.RefObject<HTMLElement | null>, onLeave: () => void) {
  // jsdom (and very old webviews) lack IntersectionObserver: treat as visible.
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        if (!entry.isIntersecting) onLeaveRef.current();
        setNear(entry.isIntersecting);
      },
      { rootMargin: LAZY_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return near;
}

function FileSection({
  file,
  isCollapsed,
  onToggle,
  mode,
  ignoreWhitespace,
  wrap,
  theme,
}: {
  file: FileDiff;
  isCollapsed: boolean;
  onToggle: () => void;
  mode: "unified" | "split";
  ignoreWhitespace: boolean;
  wrap: boolean;
  theme: "dark" | "light";
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number | null>(null);
  const near = useNearViewport(wrapperRef, () => {
    const h = bodyRef.current?.offsetHeight;
    if (h) lastHeightRef.current = h;
  });
  const [loadedHuge, setLoadedHuge] = useState(false);
  const [highlighted, setHighlighted] = useState<{
    theme: string;
    patch: string;
    lines: RenderedLine[];
  } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const isBinary = !!file.isBinary;
  const huge = useMemo(() => !isBinary && isHugePatch(file.patch), [file.patch, isBinary]);
  const skipped = isBinary || (huge && !loadedHuge);
  // Rows are only built/highlighted for files that are expanded and near the
  // viewport; everything else costs one placeholder div.
  const active = !isCollapsed && near && !skipped;

  const baseLines = useMemo(
    () => (active ? markMovedLines(parseDiffLines(file.patch)) : []),
    [active, file.patch],
  );

  useEffect(() => {
    if (!active) return;
    if (highlighted && highlighted.theme === theme && highlighted.patch === file.patch) return;
    let cancelled = false;
    (async () => {
      const rendered: RenderedLine[] = [];
      let sinceYield = 0;
      for (const line of baseLines) {
        if (cancelled) return;
        rendered.push({
          ...line,
          html: await highlightLine(line.content, file.path, theme),
        });
        sinceYield++;
        if (sinceYield >= 40) {
          sinceYield = 0;
          await new Promise((r) => setTimeout(r, 0));
          if (cancelled) return;
        }
      }
      if (cancelled) return;
      setHighlighted({ theme, patch: file.patch, lines: rendered });
    })();
    return () => {
      cancelled = true;
    };
  }, [active, baseLines, file.path, file.patch, theme, highlighted]);

  const lines: RenderedLine[] = useMemo(
    () =>
      highlighted && highlighted.theme === theme && highlighted.patch === file.patch
        ? highlighted.lines
        : baseLines.map((line) => ({ ...line, html: null })),
    [highlighted, theme, file.patch, baseLines],
  );

  // Hidden unchanged lines come from the file's full contents; what the user
  // has expanded is tracked per gap, and highlighted on demand by new line number.
  const [revealed, setRevealed] = useState<Record<number, RevealedGap>>({});
  const [gapHtml, setGapHtml] = useState<Record<number, string | null>>({});
  useEffect(() => {
    setRevealed({});
    setGapHtml({});
  }, [file.patch, file.newContent, theme]);

  const newLines = useMemo(
    () => (file.newContent == null ? null : splitFileLines(file.newContent)),
    [file.newContent],
  );
  const withGaps: RenderedLine[] = useMemo(
    () =>
      newLines
        ? insertGaps(lines, newLines, revealed, (l) => ({ ...l, html: gapHtml[l.newNo ?? -1] ?? null }))
        : lines,
    [lines, newLines, revealed, gapHtml],
  );

  useEffect(() => {
    const todo = withGaps.filter(
      (l) => l.revealed && l.html === null && l.newNo !== undefined && !(l.newNo in gapHtml),
    );
    if (todo.length === 0) return;
    let cancelled = false;
    (async () => {
      const out: Record<number, string | null> = {};
      for (const l of todo) out[l.newNo as number] = await highlightLine(l.content, file.path, theme);
      if (!cancelled) setGapHtml((prev) => ({ ...prev, ...out }));
    })();
    return () => {
      cancelled = true;
    };
  }, [withGaps, gapHtml, file.path, theme]);

  const expandGap = (id: number, action: GapAction) =>
    setRevealed((prev) => {
      const cur = prev[id] ?? { top: 0, bottom: 0 };
      const next =
        action === "all"
          ? { top: Number.MAX_SAFE_INTEGER, bottom: 0 }
          : action === "top"
            ? { ...cur, top: cur.top + GAP_STEP }
            : { ...cur, bottom: cur.bottom + GAP_STEP };
      return { ...prev, [id]: next };
    });

  // Folded runs are keyed by their first line number, not their position, so
  // revealing a gap above doesn't shift which run counts as expanded.
  const groupKey = (rows: DiffRow<RenderedLine>[]) => rows[0]?.new?.newNo ?? rows[0]?.old?.oldNo ?? -1;
  const expandGroup = (key: number) => {
    setExpandedGroups((prev) => new Set(prev).add(key));
  };

  const isMuted = (row: DiffRow<RenderedLine>): boolean =>
    ignoreWhitespace &&
    !!row.old &&
    !!row.new &&
    row.old !== row.new &&
    isWhitespaceOnlyChange(row.old.content, row.new.content);

  // A hunk-start marker (for n/p keyboard nav) goes on whichever side of the
  // row actually has a line, so unified and split views expose exactly one
  // marker per hunk regardless of how the row is rendered.
  const hunkStartSide = (
    row: DiffRow<RenderedLine>,
    hunkStartRows: Map<DiffRow<RenderedLine>, number>,
  ): "old" | "new" | null => {
    if (!hunkStartRows.has(row)) return null;
    return row.old ? "old" : "new";
  };

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`Copied ${what}`);
    else toast.error("Couldn't copy to clipboard");
  };

  const header = (
    <div className="w-full px-2 py-1 bg-elevated text-xs font-mono flex justify-between items-center sticky top-0 z-10">
      <button
        className="flex-1 min-w-0 flex items-center gap-1 text-left text-text-primary hover:bg-hover transition-colors duration-100"
        onClick={onToggle}
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="truncate">{file.path}</span>
      </button>
      <span className="flex items-center gap-2 text-text-muted shrink-0">
        <button
          className="hover:text-text-primary"
          title="Copy file path"
          aria-label="Copy file path"
          onClick={() => copy(file.path, "file path")}
        >
          <Copy size={12} />
        </button>
        {!isBinary && (
          <button
            className="hover:text-text-primary text-[10px] border border-border-subtle rounded px-1"
            title="Copy file as patch"
            aria-label="Copy file as patch"
            onClick={() => copy(file.patch, "patch")}
          >
            patch
          </button>
        )}
        <span>
          {file.status} <span className="text-success">+{file.insertions}</span>{" "}
          <span className="text-danger">-{file.deletions}</span>
        </span>
      </span>
    </div>
  );

  const renderBody = () => {
    if (isBinary) {
      return (
        <div className="bg-canvas px-2 py-3 text-xs text-text-muted font-mono">
          Binary file
        </div>
      );
    }
    if (skipped) {
      return (
        <div className="bg-canvas px-2 py-3 text-xs text-text-muted font-mono flex items-center gap-2">
          Large file ({patchLineCount(file.patch)} lines), click to load
          <button
            className="px-2 py-0.5 rounded bg-elevated hover:bg-hover text-text-primary"
            onClick={() => setLoadedHuge(true)}
          >
            Load diff
          </button>
        </div>
      );
    }
    if (!near) {
      return (
        <div
          data-testid="diff-placeholder"
          className="bg-canvas"
          style={{
            height:
              lastHeightRef.current ??
              patchLineCount(file.patch) * ESTIMATED_ROW_HEIGHT,
          }}
        />
      );
    }
    const rows = buildDiffRows(withGaps);
    const hunkStartRows = new Map(
      changeHunkStarts(rows).map((i) => [rows[i], i] as const),
    );
    const copyHunkFor = (row: DiffRow<RenderedLine>) => {
      const idx = hunkStartRows.get(row);
      return idx === undefined ? undefined : () => copy(hunkText(rows, idx), "hunk");
    };
    const displayRows = collapseContextRows(rows);
    const stats = countChangedChars(lines);
    const statsRow = (
      <div className="px-2 pb-1 font-mono text-xs text-text-muted select-none">
        <span className="text-success">+{stats.added}</span>{" "}
        <span className="text-danger">-{stats.removed}</span> characters
      </div>
    );
    const splitCell = (
      key: string,
      side: "old" | "new",
      row: DiffRow<RenderedLine>,
      interactive: boolean,
    ) => {
      const line = side === "old" ? row.old : row.new;
      return (
        <div key={key} className="bg-canvas min-w-0">
          {line ? (
            <DiffLineRow
              gutter={side}
              line={line}
              words={side === "old" ? row.oldWords : row.newWords}
              muted={interactive ? isMuted(row) : undefined}
              hunkStart={interactive ? hunkStartSide(row, hunkStartRows) === side : undefined}
              onCopyHunk={interactive ? copyHunkFor(row) : undefined}
              wrap={wrap}
            />
          ) : (
            <BlankDiffRow gutter={side} />
          )}
        </div>
      );
    };
    return mode === "unified" ? (
      <div className="bg-canvas py-1 overflow-x-auto">
        {statsRow}
        {displayRows.map((d, i) =>
          d.kind === "row" && d.row.gap ? (
            <GapRow key={i} gap={d.row.gap} onExpand={expandGap} />
          ) : d.kind === "collapsed" && !expandedGroups.has(groupKey(d.rows)) ? (
            <CollapsedRow
              key={i}
              count={d.rows.length}
              onExpand={() => expandGroup(groupKey(d.rows))}
            />
          ) : (
            flattenDiffRows(d.kind === "collapsed" ? d.rows : [d.row]).map(
              (f, j) => (
                <DiffLineRow
                  key={`${i}-${j}`}
                  gutter="both"
                  line={f.line}
                  words={f.words}
                  muted={d.kind === "row" ? isMuted(d.row) : false}
                  hunkStart={
                    d.kind === "row" &&
                    hunkStartSide(d.row, hunkStartRows) ===
                      (f.line === d.row.old ? "old" : "new")
                  }
                  onCopyHunk={d.kind === "row" ? copyHunkFor(d.row) : undefined}
                  wrap={wrap}
                />
              ),
            )
          ),
        )}
      </div>
    ) : (
      <div className="bg-border-subtle">
        <div className="bg-canvas pt-1 mb-px">{statsRow}</div>
        <div className={wrap ? "" : "overflow-x-auto"}>
          {/* One grid, old/new cells as neighbours: a wrapped line makes both
              cells of its row grow together, so the panes never drift apart. */}
          <div
            data-testid="split-grid"
            className={`grid gap-x-px bg-border-subtle ${
              wrap ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-2 min-w-max"
            }`}
          >
            {displayRows.map((d, i) => {
              if (d.kind === "row" && d.row.gap) {
                return (
                  <div key={i} className="col-span-2 bg-canvas">
                    <GapRow gap={d.row.gap} onExpand={expandGap} />
                  </div>
                );
              }
              if (d.kind === "collapsed" && !expandedGroups.has(groupKey(d.rows))) {
                return (
                  <div key={i} className="col-span-2 bg-canvas">
                    <CollapsedRow count={d.rows.length} onExpand={() => expandGroup(groupKey(d.rows))} />
                  </div>
                );
              }
              const rowsOf = d.kind === "collapsed" ? d.rows : [d.row];
              return rowsOf.flatMap((row, j) => [
                splitCell(`${i}-${j}-o`, "old", row, d.kind === "row"),
                splitCell(`${i}-${j}-n`, "new", row, d.kind === "row"),
              ]);
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={wrapperRef}
      className="border border-border-subtle rounded overflow-hidden"
    >
      {header}
      {isCollapsed ? null : <div ref={bodyRef}>{renderBody()}</div>}
    </div>
  );
}

export default function DiffViewer({ files }: { files: FileDiff[] }) {
  const mode = useDiffViewStore((s) => s.mode);
  const setMode = useDiffViewStore((s) => s.setMode);
  const ignoreWhitespace = useDiffViewStore((s) => s.ignoreWhitespace);
  const setIgnoreWhitespace = useDiffViewStore((s) => s.setIgnoreWhitespace);
  const wrapLines = useDiffViewStore((s) => s.wrapLines);
  const setWrapLines = useDiffViewStore((s) => s.setWrapLines);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const hunkIndexRef = useRef(0);
  const theme = useThemeStore((s) => s.activeMode);
  const diffFontSize = useThemeStore((s) => s.fontSize.diffView);
  const diffViewTheme = useThemeStore((s) => s.diffViewTheme);

  useEffect(() => {
    function isTyping() {
      const el = document.activeElement;
      return (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      );
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTyping() || !containerRef.current) return;
      if (e.key !== "n" && e.key !== "p") return;
      const hunks = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>("[data-hunk]"),
      );
      if (hunks.length === 0) return;
      e.preventDefault();
      hunkIndexRef.current =
        e.key === "n"
          ? Math.min(hunkIndexRef.current + 1, hunks.length - 1)
          : Math.max(hunkIndexRef.current - 1, 0);
      hunks[hunkIndexRef.current]?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const setAllCollapsed = (value: boolean) =>
    setCollapsed(Object.fromEntries(files.map((f) => [f.path, value])));

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-2"
      style={
        diffViewCssVars(diffFontSize, diffViewTheme) as React.CSSProperties
      }
    >
      <div className="flex gap-2 items-center">
        <div className="flex gap-1 bg-elevated p-0.5 rounded w-fit">
          <button
            className={`text-xs px-2 py-0.5 rounded transition-colors duration-100 press-scale ${mode === "unified" ? "bg-accent text-accent-contrast" : "text-text-muted hover:text-text-primary"}`}
            onClick={() => setMode("unified")}
          >
            Unified
          </button>
          <button
            className={`text-xs px-2 py-0.5 rounded transition-colors duration-100 press-scale ${mode === "split" ? "bg-accent text-accent-contrast" : "text-text-muted hover:text-text-primary"}`}
            onClick={() => setMode("split")}
          >
            Side-by-side
          </button>
        </div>
        <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ignoreWhitespace}
            onChange={(e) => setIgnoreWhitespace(e.target.checked)}
          />
          Ignore whitespace
        </label>
        <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={wrapLines}
            onChange={(e) => setWrapLines(e.target.checked)}
          />
          Wrap lines
        </label>
        <div className="flex gap-1 ml-auto">
          <button
            className="text-xs px-2 py-0.5 rounded text-text-muted hover:text-text-primary hover:bg-hover"
            onClick={() => setAllCollapsed(true)}
          >
            Collapse all
          </button>
          <button
            className="text-xs px-2 py-0.5 rounded text-text-muted hover:text-text-primary hover:bg-hover"
            onClick={() => setAllCollapsed(false)}
          >
            Expand all
          </button>
        </div>
      </div>
      {files.map((file) => (
        <FileSection
          key={file.path}
          file={file}
          isCollapsed={collapsed[file.path] ?? false}
          onToggle={() =>
            setCollapsed((prev) => ({
              ...prev,
              [file.path]: !(prev[file.path] ?? false),
            }))
          }
          mode={mode}
          ignoreWhitespace={ignoreWhitespace}
          wrap={wrapLines}
          theme={theme}
        />
      ))}
    </div>
  );
}
