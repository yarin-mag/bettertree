import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { rankMatches } from "../lib/fuzzyMatch";
import { getRecentBranches, recordRecentBranch } from "../lib/recentBranches";

interface BranchComboboxProps {
  value: string | undefined;
  onChange: (value: string | null) => void;
  branches: string[];
  isLoading?: boolean;
}

export default function BranchCombobox({ value, onChange, branches, isLoading }: BranchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = rankMatches(filterText, branches, (b) => b);
  const rows: (string | null)[] = [null, ...filtered];

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setFilterText("");
      setHighlightedIndex(0);
      setRecents(getRecentBranches().filter((name) => branches.includes(name)));
      inputRef.current?.focus();
    }
  }, [isOpen, branches]);

  const selectRow = (row: string | null) => {
    if (row !== null) recordRecentBranch(row);
    onChange(row);
    setIsOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectRow(rows[highlightedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={isLoading}
        aria-label={value ?? "Any"}
        className="w-32 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary text-left truncate flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
        onClick={() => setIsOpen((o) => !o)}
      >
        {isLoading ? <Loader2 size={12} className="animate-spin shrink-0" /> : null}
        <span className="truncate">{value ?? "Any"}</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-64 bg-elevated border border-border-subtle rounded-lg shadow-lg animate-pop-in">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
            <Search size={13} className="text-accent shrink-0" />
            <input
              ref={inputRef}
              className="w-full bg-transparent outline-none text-text-primary text-sm"
              placeholder="Jump to branch..."
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          {recents.length > 0 && (
            <div className="px-1 pt-1">
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-text-muted">Recent</div>
              {recents.map((name) => (
                <div
                  key={`recent-${name}`}
                  data-branch-row
                  onClick={() => selectRow(name)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary hover:bg-accent-soft"
                >
                  <span className="row-name truncate flex-1">{name}</span>
                  {name === value && (
                    <span className="text-[10px] uppercase tracking-wide text-text-muted bg-hover border border-border-subtle rounded px-1 py-0.5 shrink-0">
                      current
                    </span>
                  )}
                </div>
              ))}
              <div className="border-t border-border-subtle mt-1" />
            </div>
          )}
          <div className="max-h-52 overflow-y-auto p-1">
            {rows.map((row, i) => (
              <div
                key={row ?? "__any__"}
                data-branch-row
                onClick={() => selectRow(row)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm ${
                  i === highlightedIndex ? "bg-accent-soft" : ""
                } ${row === null ? "text-text-muted" : "text-text-primary"}`}
              >
                <span className="row-name truncate flex-1">{row ?? "Any"}</span>
                {row !== null && row === value && (
                  <span className="text-[10px] uppercase tracking-wide text-text-muted bg-hover border border-border-subtle rounded px-1 py-0.5 shrink-0">
                    current
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border-subtle text-[10px] text-text-muted">
            <span>↑ ↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </div>
        </div>
      )}
    </div>
  );
}
