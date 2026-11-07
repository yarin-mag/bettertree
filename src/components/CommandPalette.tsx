import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { useUiStore } from "../store/uiStore";
import { useViewStore } from "../store/viewStore";
import { usePinnedStore } from "../store/pinnedStore";
import { useRecentReposStore } from "../store/recentReposStore";
import { toast } from "../store/toastStore";
import { rankMatches } from "../lib/fuzzyMatch";
import { checkoutBranch } from "../lib/branchActions";
import { releaseNotesSinceLatestTag } from "../lib/latestReleaseTag";

interface PaletteItem {
  id: string;
  section: string;
  label: string;
  sub?: string;
  run: () => void | Promise<void>;
}

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { repos, activeRepoId, branches } = useWorkspaceStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const githubStatus = useGithubStore((s) => s.status);
  const openPullRequest = useGithubStore((s) => s.openPullRequest);
  const selectCommit = useUiStore((s) => s.selectCommit);
  const setActiveView = useViewStore((s) => s.setActiveView);
  const { pinnedCommits, pinnedPrs } = usePinnedStore();
  const { recentlyClosed, removeClosed } = useRecentReposStore();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((o) => !o);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setHighlighted(0);
      // Focus after the modal mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const items = useMemo<PaletteItem[]>(() => {
    const close = () => setIsOpen(false);
    const result: PaletteItem[] = [];

    for (const r of repos) {
      result.push({
        id: `repo-${r.id}`,
        section: "Repos",
        label: r.name,
        sub: r.path,
        run: () => {
          useWorkspaceStore.getState().setActiveRepo(r.id);
          setActiveView("repo");
          close();
        },
      });
    }

    if (activeRepo) {
      result.push({
        id: "release-notes-latest-tag",
        section: "Release notes",
        label: "Release notes since latest release tag",
        run: () => {
          void releaseNotesSinceLatestTag();
          setActiveView("repo");
          close();
        },
      });
      for (const b of branches) {
        result.push({
          id: `branch-${b.name}-${b.isRemote}`,
          section: "Branches",
          label: b.name,
          sub: b.isHead ? "current" : undefined,
          run: () => {
            void checkoutBranch(b.name, b.isRemote);
            setActiveView("repo");
            close();
          },
        });
      }
    }

    for (const c of pinnedCommits) {
      result.push({
        id: `commit-${c.key}`,
        section: "Pinned commits",
        label: c.summary,
        sub: c.oid.slice(0, 7),
        run: async () => {
          const repo = repos.find((r) => r.path === c.repoPath);
          if (!repo) return;
          if (repo.id !== activeRepoId) {
            await useWorkspaceStore.getState().setActiveRepo(repo.id);
          }
          setActiveView("repo");
          selectCommit(c.oid);
          close();
        },
      });
    }

    // Pinned PRs can only be jumped to for the currently active repo — the
    // app has no way to resolve an arbitrary owner/repo back to a local
    // repo/path without switching to it first and re-checking GitHub status.
    if (activeRepo && githubStatus?.available && githubStatus.owner && githubStatus.repo) {
      for (const p of pinnedPrs) {
        if (p.owner !== githubStatus.owner || p.repo !== githubStatus.repo) continue;
        result.push({
          id: `pr-${p.key}`,
          section: "Pinned pull requests",
          label: `#${p.number} ${p.title}`,
          run: async () => {
            await openPullRequest(activeRepo.path, p.number);
            setActiveView("pulls");
            close();
          },
        });
      }
    }

    for (const r of recentlyClosed) {
      result.push({
        id: `recent-${r.path}`,
        section: "Recently closed",
        label: r.name,
        sub: "reopen",
        run: async () => {
          const repo = await useWorkspaceStore.getState().addRepo(r.path);
          removeClosed(r.path);
          await useWorkspaceStore.getState().setActiveRepo(repo.id);
          setActiveView("repo");
          close();
        },
      });
    }

    return result;
  }, [
    repos,
    activeRepo,
    activeRepoId,
    branches,
    pinnedCommits,
    pinnedPrs,
    githubStatus,
    recentlyClosed,
    openPullRequest,
    selectCommit,
    setActiveView,
    removeClosed,
  ]);

  const filtered = useMemo(
    () => rankMatches(query, items, (i) => `${i.label} ${i.sub ?? ""}`),
    [query, items]
  );

  if (!isOpen) return null;

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    Promise.resolve(item.run()).catch((e) => toast.error(`Couldn't open "${item.label}": ${e}`));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(filtered[highlighted]);
    }
  };

  let lastSection = "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-24 animate-fade-in"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-full max-w-lg bg-surface border border-border-subtle rounded-lg shadow-2xl overflow-hidden animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full px-4 py-3 bg-transparent outline-none text-text-primary text-sm border-b border-border-subtle"
          placeholder="Jump to a repo, branch, pinned commit or PR..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlighted(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-text-muted text-center">No matches</div>
          )}
          {filtered.map((item, idx) => {
            const showHeader = item.section !== lastSection;
            lastSection = item.section;
            return (
              <div key={item.id}>
                {showHeader && (
                  <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-muted">
                    {item.section}
                  </div>
                )}
                <div
                  onClick={() => runItem(item)}
                  onMouseEnter={() => setHighlighted(idx)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary transition-colors duration-100 ${
                    idx === highlighted ? "bg-accent-soft" : ""
                  }`}
                >
                  <span className="truncate flex-1">{item.label}</span>
                  {item.sub && (
                    <span className="text-[10px] text-text-muted font-mono truncate max-w-[10rem] shrink-0">
                      {item.sub}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 px-3 py-2 border-t border-border-subtle text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-elevated border border-border-subtle rounded text-[9px]">↑</kbd>
            <kbd className="px-1 py-0.5 bg-elevated border border-border-subtle rounded text-[9px]">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-elevated border border-border-subtle rounded text-[9px]">↵</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-elevated border border-border-subtle rounded text-[9px]">esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
