import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { rankMatches } from "../lib/fuzzyMatch";

const MAX_VISIBLE_PER_SECTION = 50;

interface RefComboboxProps {
  value: string | null;
  onChange: (value: string) => void;
  branches: string[];
  tags: string[];
  placeholder?: string;
}

export default function RefCombobox({ value, onChange, branches, tags, placeholder }: RefComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cap the DOM rows a large branch/tag list can produce on open — a repo
  // with thousands of tags (common with CI-driven tagging) would otherwise
  // render every one of them synchronously, which is what made opening the
  // dropdown feel stuck.
  const rankedBranches = rankMatches(filterText, branches, (b) => b);
  const rankedTags = rankMatches(filterText, tags, (t) => t);
  const filteredBranches = rankedBranches.slice(0, MAX_VISIBLE_PER_SECTION);
  const filteredTags = rankedTags.slice(0, MAX_VISIBLE_PER_SECTION);
  const hiddenBranchCount = rankedBranches.length - filteredBranches.length;
  const hiddenTagCount = rankedTags.length - filteredTags.length;
  // Lets typing an arbitrary commit SHA (not just a branch/tag name) resolve
  // to something selectable — the backend's compare/checkout commands
  // accept any revspec git can parse, not just symbolic refs.
  const trimmedFilter = filterText.trim();
  const customOption =
    trimmedFilter.length > 0 && !branches.includes(trimmedFilter) && !tags.includes(trimmedFilter)
      ? trimmedFilter
      : null;
  const rows: string[] = [...filteredBranches, ...filteredTags, ...(customOption ? [customOption] : [])];

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

  useEffect(() => {
    if (isOpen) {
      setFilterText("");
      setHighlightedIndex(0);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const selectRow = (row: string) => {
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
      if (rows[highlightedIndex]) selectRow(rows[highlightedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={value ?? placeholder ?? "Select ref"}
        title={value ?? undefined}
        className="shrink-0 max-w-[22rem] px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary text-left flex items-center gap-1.5"
        onClick={() => setIsOpen((o) => !o)}
      >
        <span className="truncate">{value ?? placeholder ?? "Select..."}</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-64 bg-elevated border border-border-subtle rounded-lg shadow-lg animate-pop-in">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
            <Search size={13} className="text-accent shrink-0" />
            <input
              ref={inputRef}
              className="w-full bg-transparent outline-none text-text-primary text-sm"
              placeholder="Jump to branch or tag..."
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredBranches.length > 0 && (
              <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-text-muted">Branches</div>
            )}
            {filteredBranches.map((row, idx) => (
              <div
                key={`branch-${row}`}
                data-ref-row
                onClick={() => selectRow(row)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary ${
                  idx === highlightedIndex ? "bg-accent-soft" : ""
                }`}
              >
                <span className="truncate flex-1">{row}</span>
                {row === value && (
                  <span className="text-[10px] uppercase tracking-wide text-text-muted bg-hover border border-border-subtle rounded px-1 py-0.5 shrink-0">
                    current
                  </span>
                )}
              </div>
            ))}
            {hiddenBranchCount > 0 && (
              <div className="px-2 py-1 text-[10px] text-text-muted">+{hiddenBranchCount} more — type to search</div>
            )}
            {filteredTags.length > 0 && (
              <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-muted">Tags</div>
            )}
            {filteredTags.map((row, idx) => {
              const rowIndex = filteredBranches.length + idx;
              return (
                <div
                  key={`tag-${row}`}
                  data-ref-row
                  onClick={() => selectRow(row)}
                  onMouseEnter={() => setHighlightedIndex(rowIndex)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary ${
                    rowIndex === highlightedIndex ? "bg-accent-soft" : ""
                  }`}
                >
                  <span className="truncate flex-1">{row}</span>
                  {row === value && (
                    <span className="text-[10px] uppercase tracking-wide text-text-muted bg-hover border border-border-subtle rounded px-1 py-0.5 shrink-0">
                      current
                    </span>
                  )}
                </div>
              );
            })}
            {hiddenTagCount > 0 && (
              <div className="px-2 py-1 text-[10px] text-text-muted">+{hiddenTagCount} more — type to search</div>
            )}
            {customOption && (
              <div
                data-ref-row
                onClick={() => selectRow(customOption)}
                onMouseEnter={() => setHighlightedIndex(rows.length - 1)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary font-mono ${
                  rows.length - 1 === highlightedIndex ? "bg-accent-soft" : ""
                }`}
              >
                <span className="truncate flex-1">{customOption}</span>
                <span className="text-[10px] uppercase tracking-wide text-text-muted shrink-0">use as SHA/ref</span>
              </div>
            )}
            {rows.length === 0 && <div className="px-2 py-3 text-xs text-text-muted text-center">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
