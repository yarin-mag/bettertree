import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GitBranch, Tag as TagIcon, ChevronDown, ChevronRight, FileText, Search, X } from "lucide-react";
import { releaseNotesSinceLatestTag } from "../lib/latestReleaseTag";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { useBranchScopeStore } from "../store/branchScopeStore";
import { fuzzyMatch, rankMatches } from "../lib/fuzzyMatch";
import { useVirtualList } from "../hooks/useVirtualList";
import { useGithubStore } from "../store/githubStore";
import { useCiStatusStore } from "../store/ciStatusStore";
import { useUiStore } from "../store/uiStore";
import CiBadge, { useCiBadge } from "./CiBadge";
import { errorMessage, openIfDirty } from "../lib/dirtyCheckout";
import { releaseNotesSinceTag } from "../lib/releaseNotes";
import { useBranchActionStore } from "../store/branchActionStore";
import { useContextMenu } from "./ContextMenu";
import { checkoutBranch, copyWithToast, jumpToCommit } from "../lib/branchActions";
import type { BranchInfo, TagInfo } from "../lib/tauri";

const ROW_HEIGHT = 24;

// Windowed list for the sidebar sections: only the rows in (or near) view are
// mounted, so repos with thousands of branches/tags stay responsive.
function VirtualRows<T>({
  items,
  maxHeight,
  testId,
  getKey,
  renderRow,
  onWindow,
}: {
  items: T[];
  maxHeight: number;
  testId?: string;
  getKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  onWindow?: (items: T[]) => void;
}) {
  const { ref, onScroll, start, end, padTop, padBottom } = useVirtualList({
    count: items.length,
    itemHeight: ROW_HEIGHT,
  });
  useEffect(() => {
    onWindow?.(items.slice(start, end));
  }, [start, end, items, onWindow]);
  return (
    <div ref={ref} onScroll={onScroll} data-testid={testId} className="overflow-y-auto" style={{ maxHeight }}>
      <div style={{ height: padTop }} aria-hidden />
      {items.slice(start, end).map((item) => (
        <div key={getKey(item)}>{renderRow(item)}</div>
      ))}
      <div style={{ height: padBottom }} aria-hidden />
    </div>
  );
}

function SectionDivider() {
  return (
    <div
      data-testid="section-divider"
      className="h-px my-2"
      style={{ background: "linear-gradient(to right, transparent, var(--border-subtle), transparent)" }}
    />
  );
}

interface SectionSearchProps {
  label: string;
  clearLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}

function SectionSearch({ label, clearLabel, placeholder, value, onChange, onClose }: SectionSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1.5 px-1 py-1">
      <Search size={11} className="text-text-muted shrink-0" />
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        placeholder={placeholder}
        aria-label={label}
        className="flex-1 min-w-0 bg-elevated border border-border-subtle rounded px-1.5 py-0.5 text-xs text-text-primary outline-none"
      />
      {value && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange("")}
          className="text-text-muted hover:text-text-primary shrink-0"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

const BranchRow = memo(function BranchRow({
  branch,
  onSwitch,
  onJump,
  onMenu,
}: {
  branch: BranchInfo;
  onSwitch: (name: string, isRemote: boolean) => void;
  onJump: (oid: string) => void;
  onMenu: (e: React.MouseEvent, branch: BranchInfo) => void;
}) {
  const { name, isHead, isRemote } = branch;
  const { state: ciState, title: ciTitle } = useCiBadge(branch.targetOid);
  return (
    <div
      data-head={isHead}
      style={{ height: ROW_HEIGHT }}
      onClick={(e) => {
        // A double-click (checkout) also fires two single clicks; only jump on the first.
        if (e.detail <= 1) onJump(branch.targetOid);
      }}
      onDoubleClick={() => onSwitch(name, isRemote)}
      onContextMenu={(e) => onMenu(e, branch)}
      className={`flex items-center gap-1.5 px-2 rounded cursor-pointer ${
        isRemote ? "text-text-muted" : isHead ? "bg-accent-soft text-accent font-medium" : "text-text-primary"
      }`}
    >
      <GitBranch size={12} className="shrink-0" />
      <span className="truncate">{name}</span>
      <CiBadge
        state={ciState}
        title={ciTitle}
        onClick={() => {
          useUiStore.getState().selectCommit(branch.targetOid);
          useUiStore.getState().setDrawerTab("checks");
        }}
      />
    </div>
  );
});

export default function BranchTree() {
  const { branches, tags, repos, activeRepoId, switchBranch, checkoutTag, headDetached, headOid } =
    useWorkspaceStore();
  const { query } = useSearchStore();
  const { showRemoteBranches, toggleShowRemoteBranches } = useBranchScopeStore();
  const [error, setError] = useState<string | null>(null);
  const [remotesCollapsed, setRemotesCollapsed] = useState(true);
  const [branchSearchOpen, setBranchSearchOpen] = useState(false);
  const [branchFilterText, setBranchFilterText] = useState("");
  const [tagSearchOpen, setTagSearchOpen] = useState(false);
  const [tagFilterText, setTagFilterText] = useState("");
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  // Inputs stay bound to the immediate values; the heavy list filtering runs
  // off deferred copies so typing never waits on a re-render of the lists.
  const deferredQuery = useDeferredValue(query);
  const deferredBranchFilter = useDeferredValue(branchFilterText);
  const deferredTagFilter = useDeferredValue(tagFilterText);

  const local = useMemo(() => {
    const f = deferredBranchFilter.trim().toLowerCase();
    return rankMatches(
      deferredQuery,
      branches.filter((b) => !b.isRemote && (!f || b.name.toLowerCase().includes(f))),
      (b) => b.name
    );
  }, [branches, deferredQuery, deferredBranchFilter]);
  // The current branch is pinned above the windowed list (so it is always
  // visible) and removed from it; it follows the same filters as the list.
  const pinned = useMemo(() => local.find((b) => b.isHead), [local]);
  const unpinnedLocal = useMemo(() => local.filter((b) => !b.isHead), [local]);
  const remote = useMemo(() => {
    const f = deferredBranchFilter.trim().toLowerCase();
    return rankMatches(
      deferredQuery,
      branches.filter((b) => b.isRemote && (!f || b.name.toLowerCase().includes(f))),
      (b) => b.name
    );
  }, [branches, deferredQuery, deferredBranchFilter]);
  const filteredTags = useMemo(() => {
    const f = deferredTagFilter.trim().toLowerCase();
    return tags.filter((t) => fuzzyMatch(deferredQuery, t.name) && (!f || t.name.toLowerCase().includes(f)));
  }, [tags, deferredQuery, deferredTagFilter]);

  const githubAvailable = useGithubStore((s) => s.status?.available);
  const repoPath = activeRepo?.path;
  const requestTipStatuses = useCallback(
    (items: BranchInfo[]) => {
      if (!githubAvailable || !repoPath || items.length === 0) return;
      useCiStatusStore.getState().request(repoPath, [...new Set(items.map((b) => b.targetOid))]);
    },
    [githubAvailable, repoPath]
  );

  const pinnedOid = pinned?.targetOid;
  useEffect(() => {
    if (pinnedOid) requestTipStatuses([{ targetOid: pinnedOid } as BranchInfo]);
  }, [pinnedOid, requestTipStatuses]);

  const closeBranchSearch = () => {
    setBranchSearchOpen(false);
    setBranchFilterText("");
  };
  const closeTagSearch = () => {
    setTagSearchOpen(false);
    setTagFilterText("");
  };

  const handleSwitch = async (branchName: string, isRemote: boolean) => {
    setError(null);
    try {
      await switchBranch(activeRepo?.path as string, branchName, isRemote);
    } catch (e) {
      if (!openIfDirty(e, { kind: "branch", name: branchName, isRemote })) setError(errorMessage(e));
    }
  };

  const { openCreateBranch } = useBranchActionStore();
  const { openMenu, menu } = useContextMenu();

  const openBranchMenu = (e: React.MouseEvent, b: BranchInfo) =>
    openMenu(e, [
      { label: `Checkout ${b.name}`, disabled: b.isHead, onSelect: () => void checkoutBranch(b.name, b.isRemote) },
      { label: "Copy branch name", onSelect: () => void copyWithToast(b.name, "branch name"), separatorBefore: true },
      { label: "Create branch here…", onSelect: () => openCreateBranch(b.targetOid, b.name) },
    ]);
  const openTagMenu = (e: React.MouseEvent, t: TagInfo) =>
    openMenu(e, [
      { label: "Checkout tag", onSelect: () => void handleCheckoutTag(t.name) },
      { label: "Copy tag name", onSelect: () => void copyWithToast(t.name, "tag name"), separatorBefore: true },
      { label: "Create branch here…", onSelect: () => openCreateBranch(t.targetOid, t.name) },
      { label: "Release notes since this tag", onSelect: () => releaseNotesSinceTag(t), separatorBefore: true },
    ]);

  const handleCheckoutTag = async (tagName: string) => {
    setError(null);
    try {
      await checkoutTag(activeRepo?.path as string, tagName);
    } catch (e) {
      if (!openIfDirty(e, { kind: "tag", name: tagName, isRemote: false })) setError(errorMessage(e));
    }
  };

  return (
    <div className="text-sm p-2">
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <div className="text-xs uppercase text-text-muted">Branches</div>
          <button
            type="button"
            aria-label="Search branches"
            onClick={() => setBranchSearchOpen((o) => !o)}
            className="text-text-muted hover:text-text-primary"
          >
            <Search size={11} />
          </button>
        </div>
        <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showRemoteBranches}
            onChange={toggleShowRemoteBranches}
            aria-label="Show remotes"
          />
          Show remotes
        </label>
      </div>
      {branchSearchOpen && (
        <SectionSearch
          label="Filter branches"
          clearLabel="Clear branch filter"
          placeholder="Filter branches..."
          value={branchFilterText}
          onChange={setBranchFilterText}
          onClose={closeBranchSearch}
        />
      )}
      {error && <div className="text-xs text-danger px-2 py-0.5">{error}</div>}
      {headDetached && (
        <div className="text-xs text-text-muted px-2 py-0.5 italic">
          Detached @ {tags.find((t) => t.targetOid === headOid)?.name ?? headOid?.slice(0, 7)}
        </div>
      )}
      {pinned && (
        <div data-testid="pinned-branch">
          <div className="text-[10px] uppercase text-text-muted px-2">Current</div>
          <BranchRow branch={pinned} onSwitch={handleSwitch} onJump={jumpToCommit} onMenu={openBranchMenu} />
        </div>
      )}
      <VirtualRows
        items={unpinnedLocal}
        maxHeight={192}
        testId="local-branches"
        onWindow={requestTipStatuses}
        getKey={(b) => b.name}
        renderRow={(b) => <BranchRow branch={b} onSwitch={handleSwitch} onJump={jumpToCommit} onMenu={openBranchMenu} />}
      />
      <SectionDivider />
      {showRemoteBranches && (
        <>
          <button
            type="button"
            className="flex items-center gap-1 w-full text-left text-xs uppercase text-text-muted hover:text-text-primary"
            onClick={() => setRemotesCollapsed((c) => !c)}
          >
            {remotesCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            Remotes ({remote.length})
          </button>
          {!remotesCollapsed && (
            <VirtualRows
              items={remote}
              maxHeight={160}
              testId="remote-branches"
              getKey={(b) => b.name}
              renderRow={(b) => (
                <BranchRow branch={b} onSwitch={handleSwitch} onJump={jumpToCommit} onMenu={openBranchMenu} />
              )}
            />
          )}
          <SectionDivider />
        </>
      )}
      <div className="flex items-center gap-1.5">
        <div className="text-xs uppercase text-text-muted">Tags</div>
        <button
          type="button"
          aria-label="Search tags"
          onClick={() => setTagSearchOpen((o) => !o)}
          className="text-text-muted hover:text-text-primary"
        >
          <Search size={11} />
        </button>
        <button
          type="button"
          aria-label="Release notes since latest release tag"
          title="Release notes since the latest release tag"
          disabled={!activeRepo}
          onClick={() => void releaseNotesSinceLatestTag()}
          className="text-text-muted hover:text-text-primary disabled:opacity-40"
        >
          <FileText size={11} />
        </button>
      </div>
      {tagSearchOpen && (
        <SectionSearch
          label="Filter tags"
          clearLabel="Clear tag filter"
          placeholder="Filter tags..."
          value={tagFilterText}
          onChange={setTagFilterText}
          onClose={closeTagSearch}
        />
      )}
      <VirtualRows
        items={filteredTags}
        maxHeight={160}
        testId="tag-list"
        getKey={(t) => t.name}
        renderRow={(t) => (
          <div
            style={{ height: ROW_HEIGHT }}
            onClick={(e) => {
              if (e.detail <= 1) void jumpToCommit(t.targetOid);
            }}
            onDoubleClick={() => handleCheckoutTag(t.name)}
            onContextMenu={(e) => openTagMenu(e, t)}
            className="flex items-center gap-1.5 px-2 text-text-primary cursor-pointer"
          >
            <TagIcon size={12} className="shrink-0" />
            <span className="truncate">{t.name}</span>
          </div>
        )}
      />
      {menu}
    </div>
  );
}
