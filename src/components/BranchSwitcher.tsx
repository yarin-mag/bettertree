import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Copy, GitBranch, Search } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { rankMatches } from "../lib/fuzzyMatch";
import { getRecentBranches, recordRecentBranch } from "../lib/recentBranches";
import { checkoutBranch, copyWithToast } from "../lib/branchActions";
import TruncatedBadge from "./TruncatedBadge";

interface Item {
  name: string;
  isRemote: boolean;
}
interface Row extends Item {
  recent?: boolean;
}

interface Props {
  /** Text on the chip: the branch name, or "detached @ …". */
  chipName: string;
  detached: boolean;
}

// The branch chip in the toolbar. Clicking it opens a searchable list of
// branches to switch to, with the search box focused.
export default function BranchSwitcher({ chipName, detached }: Props) {
  const branches = useWorkspaceStore((s) => s.branches);
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Local branches first, then remote branches that have no local copy of the same name.
  const items = useMemo<Item[]>(() => {
    const locals = branches.filter((b) => !b.isRemote).map((b) => ({ name: b.name, isRemote: false }));
    const localNames = new Set(locals.map((l) => l.name));
    const remoteOnly = branches
      .filter((b) => b.isRemote && !localNames.has(b.name.split("/").slice(1).join("/")))
      .map((b) => ({ name: b.name, isRemote: true }));
    return [...locals, ...remoteOnly];
  }, [branches]);

  const [recents, setRecents] = useState<string[]>([]);

  const rows = useMemo<Row[]>(() => {
    if (filterText) return rankMatches(filterText, items, (i) => i.name);
    const recentItems = recents
      .map((name) => items.find((i) => i.name === name))
      .filter((i): i is Item => !!i)
      .map((i) => ({ ...i, recent: true }));
    const recentNames = new Set(recentItems.map((r) => r.name));
    return [...recentItems, ...items.filter((i) => !recentNames.has(i.name))];
  }, [filterText, items, recents]);

  useEffect(() => {
    if (!isOpen) return;
    setFilterText("");
    setHighlighted(0);
    setRecents(getRecentBranches());
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  useEffect(() => {
    listRef.current
      ?.querySelectorAll<HTMLElement>("[data-branch-row]")
      [highlighted]?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted]);

  const isCurrent = (row: Item) => !detached && row.name === chipName;

  const select = (row: Row | undefined) => {
    setIsOpen(false);
    if (!row || isCurrent(row)) return;
    recordRecentBranch(row.name);
    void checkoutBranch(row.name, row.isRemote);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(rows[highlighted]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <TruncatedBadge
        testId="branch-chip"
        name={chipName}
        icon={<GitBranch size={10} className="inline-block mr-1 -mt-px" />}
        className="bg-accent-soft text-accent shrink-0"
        maxWidthClass="max-w-[16rem]"
        onClick={() => setIsOpen((o) => !o)}
      />
      {isOpen && (
        <div className="absolute top-full left-0 z-30 mt-1 w-72 bg-elevated border border-border-subtle rounded-lg shadow-lg animate-pop-in">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
            <Search size={13} className="text-accent shrink-0" />
            <input
              ref={inputRef}
              className="w-full bg-transparent outline-none text-text-primary text-sm"
              placeholder="Jump to branch..."
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="flex items-center justify-between px-3 py-1 text-[10px] uppercase tracking-wide text-text-muted">
            <span>Switch branch</span>
            {!detached && (
              <button
                type="button"
                aria-label="Copy branch name"
                title="Copy current branch name"
                className="hover:text-text-primary"
                onClick={() => void copyWithToast(chipName, "branch name")}
              >
                <Copy size={11} />
              </button>
            )}
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
            {rows.length === 0 && <div className="px-2 py-3 text-sm text-text-muted">No matching branches</div>}
            {rows.map((row, i) => (
              <div key={`${row.recent ? "r" : "b"}-${row.name}`}>
                {row.recent && i === 0 && (
                  <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-text-muted">Recent</div>
                )}
                <div
                  data-branch-row
                  onClick={() => select(row)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary ${
                    i === highlighted ? "bg-accent-soft" : ""
                  }`}
                >
                  <span className="row-name truncate flex-1">{row.name}</span>
                  {isCurrent(row) && (
                    <span className="text-[10px] uppercase tracking-wide text-text-muted bg-hover border border-border-subtle rounded px-1 py-0.5 shrink-0">
                      current
                    </span>
                  )}
                  {row.isRemote && <span className="text-[10px] text-text-muted shrink-0">remote</span>}
                </div>
                {row.recent && !rows[i + 1]?.recent && <div className="border-t border-border-subtle my-1" />}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border-subtle text-[10px] text-text-muted">
            <span>↑ ↓ navigate</span>
            <span>↵ switch</span>
            <span>esc close</span>
          </div>
        </div>
      )}
    </div>
  );
}
