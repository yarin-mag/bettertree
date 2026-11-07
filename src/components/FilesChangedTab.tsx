import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Search, X } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { usePrDiffStore } from "../store/prDiffStore";
import Markdown from "./Markdown";
import { hashHue } from "../lib/hashColor";
import { initials } from "../lib/prDisplay";
import type { DiffLineInfo, PrFileDiff, PrReviewComment } from "../lib/tauri";

const LARGE_FILE_LINE_THRESHOLD = 200;

interface LineTarget {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
}

function lineTarget(path: string, line: DiffLineInfo): LineTarget | null {
  if (line.kind === "del") {
    return line.oldLine != null ? { path, line: line.oldLine, side: "LEFT" } : null;
  }
  return line.newLine != null ? { path, line: line.newLine, side: "RIGHT" } : null;
}

function targetKey(t: LineTarget): string {
  return `${t.path}:${t.side}:${t.line}`;
}

/** Highlights the first case-insensitive match of `query` in `text`. */
function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent-soft text-accent rounded-sm">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function FilesChangedTab() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { selectedPrNumber } = useGithubStore();
  const { diff, reviewComments, addReviewComment } = usePrDiffStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [openComposer, setOpenComposer] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCollapsedOverrides, setSearchCollapsedOverrides] = useState<Set<string>>(new Set());
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchCollapsedOverrides(new Set());
  };

  useEffect(() => {
    if (diff) {
      setCollapsedPaths(
        new Set(diff.files.filter((f) => f.lines.length > LARGE_FILE_LINE_THRESHOLD).map((f) => f.path))
      );
    }
  }, [diff]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        closeSearch();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery]);

  const query = searchQuery.trim().toLowerCase();
  const isSearching = query.length > 0;
  const matchesPath = (file: PrFileDiff) => file.path.toLowerCase().includes(query);
  const matchesLine = (line: DiffLineInfo) => line.content.toLowerCase().includes(query);
  const allFiles = diff?.files ?? [];
  const visibleFiles = allFiles.filter((f) => !isSearching || matchesPath(f) || f.lines.some(matchesLine));
  const matchList: { path: string; lineIndex: number }[] = [];
  if (isSearching) {
    visibleFiles.forEach((file) => {
      file.lines.forEach((line, idx) => {
        if (matchesLine(line)) matchList.push({ path: file.path, lineIndex: idx });
      });
    });
  }
  const currentMatch =
    matchList.length > 0 ? matchList[((currentMatchIndex % matchList.length) + matchList.length) % matchList.length] : null;

  useEffect(() => {
    if (!currentMatch) return;
    const el = document.getElementById(`match-${currentMatch.path}-${currentMatch.lineIndex}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatchIndex, searchQuery, currentMatch?.path, currentMatch?.lineIndex]);

  useEffect(() => {
    if (!openComposer) return;
    const el = document.getElementById(`composer-${openComposer}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    el?.querySelector("textarea")?.focus();
  }, [openComposer]);

  if (!diff) return null;

  const findNext = () => {
    if (matchList.length === 0) return;
    setCurrentMatchIndex((i) => (i + 1) % matchList.length);
  };
  const findPrev = () => {
    if (matchList.length === 0) return;
    setCurrentMatchIndex((i) => (i - 1 + matchList.length) % matchList.length);
  };

  const toggleCollapsed = (path: string) => {
    const setter = isSearching ? setSearchCollapsedOverrides : setCollapsedPaths;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const commentsFor = (t: LineTarget): PrReviewComment[] =>
    reviewComments.filter((c) => c.path === t.path && c.side === t.side && c.line === t.line);

  const openComposerFor = (t: LineTarget) => {
    setOpenComposer(targetKey(t));
    setDraft("");
    setError(null);
  };

  const submitComment = async (t: LineTarget) => {
    if (!activeRepo || selectedPrNumber == null || !draft.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await addReviewComment(activeRepo.path, selectedPrNumber, t.path, t.line, t.side, draft);
      setOpenComposer(null);
      setDraft("");
    } catch (e) {
      setError(String(e));
    } finally {
      setPosting(false);
    }
  };

  // In split mode, context lines render in both the old and new panes — only
  // the copy matching the line's real comment-anchor side shows the compose
  // affordance/thread, so it doesn't appear twice.
  const renderLineRow = (file: PrFileDiff, line: DiffLineInfo, i: number, paneSide?: "LEFT" | "RIGHT") => {
    const target = lineTarget(file.path, line);
    const showTarget = target != null && (paneSide == null || target.side === paneSide);
    const key = target ? targetKey(target) : `noline-${i}`;
    const comments = showTarget && target ? commentsFor(target) : [];
    const originalIndex = file.lines.indexOf(line);
    const isActiveMatch = isSearching && currentMatch?.path === file.path && currentMatch?.lineIndex === originalIndex;
    return (
      <div key={i}>
        <div
          id={isSearching ? `match-${file.path}-${originalIndex}` : undefined}
          className={`flex items-start gap-2 px-2 ${
            line.kind === "add" ? "bg-success-soft" : line.kind === "del" ? "bg-danger-soft" : ""
          } ${isActiveMatch ? "ring-1 ring-inset ring-accent" : ""}`}
        >
          {paneSide !== "RIGHT" && (
            <span className="w-8 text-right text-text-muted shrink-0 select-none">{line.oldLine ?? ""}</span>
          )}
          {paneSide !== "LEFT" && (
            <span className="w-8 text-right text-text-muted shrink-0 select-none">{line.newLine ?? ""}</span>
          )}
          <span className="shrink-0 text-text-muted select-none">
            {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
          </span>
          <span className="whitespace-pre-wrap flex-1 text-text-primary">
            {isSearching ? highlightMatch(line.content, query) : line.content}
          </span>
          {showTarget && target && (
            <button
              type="button"
              aria-label={`Comment on ${target.side === "LEFT" ? "old" : "new"} line ${target.line}`}
              className="shrink-0 text-text-muted hover:text-accent"
              onClick={() => openComposerFor(target)}
            >
              +
            </button>
          )}
        </div>
        {showTarget &&
          comments.map((comment) => (
            <div key={comment.id} className="ml-16 my-1 border border-border-subtle rounded-md overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated border-b border-border-subtle text-xs text-text-muted">
                <span
                  className="flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold shrink-0 text-white"
                  style={{ backgroundColor: `hsl(${hashHue(comment.author)}, 55%, 45%)` }}
                  title={comment.author}
                >
                  {initials(comment.author)}
                </span>
                <span className="font-medium text-text-primary">{comment.author}</span> · {comment.createdAt}
              </div>
              <div className="px-3 py-2 markdown-body">
                <Markdown>{comment.body}</Markdown>
              </div>
            </div>
          ))}
        {showTarget && target && openComposer === key && (
          <div id={`composer-${key}`} className="ml-16 my-1 flex flex-col gap-2">
            <textarea
              className="w-full min-h-16 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none text-xs font-sans"
              placeholder="Leave a comment on this line"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {error && <span className="text-xs text-danger">{error}</span>}
            <div className="flex gap-2">
              <button
                type="button"
                className="px-3 py-1 bg-accent text-accent-contrast rounded text-xs font-medium disabled:opacity-50"
                onClick={() => submitComment(target)}
                disabled={posting || !draft.trim()}
              >
                Comment
              </button>
              <button type="button" className="px-3 py-1 text-xs text-text-muted" onClick={() => setOpenComposer(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    // File cards below need shrink-0 — without it, flexbox's default shrink
    // behavior squeezes them to fit this container's height instead of
    // letting them keep their natural size, silently clipping lines via the
    // card's own overflow-hidden instead of this container actually scrolling.
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
      <div className="shrink-0 flex gap-1 bg-elevated p-0.5 rounded w-fit">
        <button
          type="button"
          className={`text-xs px-2 py-0.5 rounded ${mode === "unified" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
          onClick={() => setMode("unified")}
        >
          Unified
        </button>
        <button
          type="button"
          className={`text-xs px-2 py-0.5 rounded ${mode === "split" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
          onClick={() => setMode("split")}
        >
          Side-by-side
        </button>
        {!searchOpen && (
          <button
            type="button"
            aria-label="Search files or code"
            title="Search files or code (Cmd+F / Ctrl+F)"
            className="ml-2 pl-2 border-l border-border-subtle text-text-muted hover:text-text-primary"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={13} />
          </button>
        )}
        {searchOpen && (
          <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border-subtle">
            <Search size={12} className="text-text-muted shrink-0" />
            <input
              ref={searchInputRef}
              className="bg-transparent outline-none text-xs w-56 text-text-primary placeholder:text-text-muted"
              placeholder="Search files or code…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.shiftKey) findPrev();
                  else findNext();
                }
              }}
            />
            {isSearching && (
              <span className="text-[10px] text-text-muted tabular-nums whitespace-nowrap">
                {matchList.length === 0 ? "0 results" : `${(currentMatchIndex % matchList.length) + 1} of ${matchList.length}`}
              </span>
            )}
            <button
              type="button"
              aria-label="Find previous"
              className="text-text-muted hover:text-text-primary disabled:opacity-40"
              disabled={matchList.length === 0}
              onClick={findPrev}
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              aria-label="Find next"
              className="text-text-muted hover:text-text-primary disabled:opacity-40"
              disabled={matchList.length === 0}
              onClick={findNext}
            >
              <ChevronDown size={12} />
            </button>
            <button
              type="button"
              aria-label="Close search"
              className="text-text-muted hover:text-text-primary"
              onClick={closeSearch}
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
      {visibleFiles.map((file: PrFileDiff) => {
        const collapsed = isSearching ? searchCollapsedOverrides.has(file.path) : collapsedPaths.has(file.path);
        const lines = isSearching && !matchesPath(file) ? file.lines.filter(matchesLine) : file.lines;
        return (
        <div key={file.path} className="shrink-0 border border-border-subtle rounded-md overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 bg-elevated border-b border-border-subtle text-xs hover:bg-hover"
            onClick={() => toggleCollapsed(file.path)}
          >
            {collapsed ? <ChevronRight size={12} className="shrink-0 text-text-muted" /> : <ChevronDown size={12} className="shrink-0 text-text-muted" />}
            <span className="font-mono text-text-primary">{isSearching ? highlightMatch(file.path, query) : file.path}</span>
            <span className="text-success">+{file.insertions}</span>
            <span className="text-danger">-{file.deletions}</span>
          </button>
          {!collapsed && (
            mode === "unified" ? (
              <div className="font-mono text-[11px]">
                {lines.map((line, i) => renderLineRow(file, line, i))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-px bg-border-subtle font-mono text-[11px]">
                <div className="bg-canvas">
                  {lines.filter((l) => l.kind !== "add").map((line, i) => renderLineRow(file, line, i, "LEFT"))}
                </div>
                <div className="bg-canvas">
                  {lines.filter((l) => l.kind !== "del").map((line, i) => renderLineRow(file, line, i, "RIGHT"))}
                </div>
              </div>
            )
          )}
        </div>
        );
      })}
    </div>
  );
}
