import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { useUiStore } from "../store/uiStore";
import { fuzzyMatch } from "../lib/fuzzyMatch";
import { refsByOid } from "../lib/refsByOid";
import { useGraphFocusStore } from "../store/graphFocusStore";
import { toast } from "../store/toastStore";
import { useVirtualList } from "../hooks/useVirtualList";
import { useGithubStore } from "../store/githubStore";
import { useCiStatusStore } from "../store/ciStatusStore";
import { useShortcut } from "../hooks/useKeyboardShortcuts";
import CommitGraphRow, { ROW_HEIGHT } from "./CommitGraphRow";
import ReleaseNotesPickBanner from "./ReleaseNotesPickBanner";
import { useReleaseNotesStore, selectPicking } from "../store/releaseNotesStore";

function matchesCommit(query: string, oid: string, summary: string, author: string): boolean {
  if (query.length === 0) return true;
  if (fuzzyMatch(query, summary)) return true;
  if (fuzzyMatch(query, author)) return true;
  return oid.toLowerCase().startsWith(query.toLowerCase());
}

export default function CommitGraph() {
  const { commits, branches, tags, hasMoreCommits, isLoadingMoreCommits, loadMoreCommits } = useWorkspaceStore();
  const { query: liveQuery } = useSearchStore();
  const query = useDeferredValue(liveQuery);
  const selectCommit = useUiStore((s) => s.selectCommit);
  const isFiltered = query.length > 0;
  const visible = useMemo(
    () => commits.filter((c) => matchesCommit(query, c.oid, c.summary, c.author)),
    [commits, query]
  );
  const refMap = useMemo(() => refsByOid(branches, tags), [branches, tags]);
  const [activeIndex, setActiveIndex] = useState(0);
  const { ref: containerRef, onScroll, scrollToIndex, start, end, padTop, padBottom } = useVirtualList({
    count: visible.length,
    itemHeight: ROW_HEIGHT,
  });
  const repoPath = useWorkspaceStore((s) => s.repos.find((r) => r.id === s.activeRepoId)?.path);
  const githubAvailable = useGithubStore((s) => s.status?.available);
  useEffect(() => {
    if (!githubAvailable || !repoPath) return;
    const oids = visible.slice(start, end).map((c) => c.oid);
    if (oids.length > 0) useCiStatusStore.getState().request(repoPath, oids);
  }, [githubAvailable, repoPath, visible, start, end]);
  const picking = useReleaseNotesStore(selectPicking);
  const anchorOid = useReleaseNotesStore((s) => s.from?.oid ?? s.to?.oid ?? null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // While picking the second end of a release-notes range, tint the rows between the marked end and the hovered row.
  const rangeBounds = useMemo(() => {
    if (!picking || hoverIndex === null || !anchorOid) return null;
    const anchor = visible.findIndex((c) => c.oid === anchorOid);
    if (anchor < 0) return null;
    return [Math.min(anchor, hoverIndex), Math.max(anchor, hoverIndex)] as const;
  }, [picking, hoverIndex, anchorOid, visible]);
  const focusOid = useGraphFocusStore((s) => s.requestedOid);
  const focusNonce = useGraphFocusStore((s) => s.nonce);

  // Paging in more commits keeps the same head, so it must not reset the selection.
  const firstOid = commits[0]?.oid;
  useEffect(() => {
    setActiveIndex(0);
  }, [query, firstOid]);

  // A request from a branch badge / sidebar click: highlight and scroll to that commit.
  useEffect(() => {
    if (!focusOid) return;
    const index = visible.findIndex((c) => c.oid === focusOid);
    if (index >= 0) {
      setActiveIndex(index);
      scrollToIndex(index, "center");
    } else if (commits.some((c) => c.oid === focusOid)) {
      toast.info("That commit is hidden by the current search filter");
    } else {
      return;
    }
    useGraphFocusStore.getState().clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOid, focusNonce, visible]);

  const move = (delta: number) => (e: KeyboardEvent) => {
    e.preventDefault();
    const next = Math.min(Math.max(activeIndex + delta, 0), visible.length - 1);
    setActiveIndex(next);
    scrollToIndex(next);
  };
  const hasRows = visible.length > 0;
  useShortcut(
    { id: "commits.next", keys: ["j", "ArrowDown"], display: "j / ↓", description: "Next commit", group: "Commits" },
    move(1),
    hasRows
  );
  useShortcut(
    { id: "commits.prev", keys: ["k", "ArrowUp"], display: "k / ↑", description: "Previous commit", group: "Commits" },
    move(-1),
    hasRows
  );
  useShortcut(
    { id: "commits.open", keys: ["Enter"], display: "Enter", description: "Open selected commit", group: "Commits" },
    () => {
      // Enter on a focused button/menu item activates that control instead.
      const el = document.activeElement;
      if (el instanceof HTMLElement && (el.closest("button, a, [role='menu']") || el.tagName === "SUMMARY")) return;
      const commit = visible[activeIndex];
      if (commit) selectCommit(commit.oid);
    },
    hasRows
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
    <ReleaseNotesPickBanner />
    <div
      ref={containerRef}
      onScroll={onScroll}
      onMouseLeave={() => setHoverIndex(null)}
      className="flex-1 overflow-y-auto bg-canvas"
    >
      <div style={{ height: padTop }} aria-hidden />
      {visible.slice(start, end).map((c, j) => {
        const i = start + j;
        return (
          <CommitGraphRow
            key={c.oid}
            commit={c}
            prevActiveLanes={isFiltered ? undefined : visible[i - 1]?.activeLanes}
            showGraphLines={!isFiltered}
            refs={refMap.get(c.oid)}
            active={i === activeIndex}
            inRange={!!rangeBounds && i >= rangeBounds[0] && i <= rangeBounds[1]}
            onHover={picking ? () => setHoverIndex(i) : undefined}
          />
        );
      })}
      <div style={{ height: padBottom }} aria-hidden />
      {hasMoreCommits && (
        <div className="flex justify-center py-3">
          <button
            type="button"
            className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary border border-border-subtle rounded disabled:opacity-50"
            onClick={() => loadMoreCommits()}
            disabled={isLoadingMoreCommits}
          >
            {isLoadingMoreCommits ? "Loading…" : "Load more commits"}
          </button>
        </div>
      )}
    </div>
    </div>
  );
}
