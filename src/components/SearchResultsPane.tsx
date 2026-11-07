import { useEffect } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useSearchStore } from "../store/searchStore";
import { useUiStore } from "../store/uiStore";
import { highlightMatch } from "../lib/highlightMatch";
import AdvancedSearch from "./AdvancedSearch";

export default function SearchResultsPane() {
  const { advancedResults, isSearching, deactivateSearch, historyQuery } = useSearchStore();
  const { selectedCommitOid, isLoadingCommit, selectCommit } = useUiStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") deactivateSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deactivateSearch]);

  const handleSelect = (oid: string) => {
    selectCommit(oid);
    deactivateSearch();
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-64 flex-shrink-0 border-r border-border-subtle overflow-y-auto">
        <button
          type="button"
          onClick={deactivateSearch}
          className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-text-muted hover:bg-hover hover:text-text-primary border-b border-border-subtle"
        >
          <ArrowLeft size={12} /> Back to commits
        </button>
        <AdvancedSearch />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border-subtle text-xs uppercase text-text-muted">
          Search results
        </div>
        <div className="flex-1 overflow-y-auto">
          {isSearching && (
            <div className="flex items-center gap-1.5 px-3 py-2 text-sm text-text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading results...
            </div>
          )}
          {!isSearching && advancedResults.length === 0 && (
            <div className="px-3 py-2 text-sm text-text-muted">No results</div>
          )}
          {!isSearching &&
            advancedResults.map((hit) => {
              const isSelected = hit.oid === selectedCommitOid;
              return (
                <div
                  key={hit.oid}
                  data-testid="search-result-hit"
                  onClick={() => handleSelect(hit.oid)}
                  className={`px-3 py-2 border-b border-border-subtle cursor-pointer flex items-center justify-between gap-2 ${
                    isSelected ? "bg-accent-soft text-accent" : "hover:bg-hover"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate text-text-primary">{highlightMatch(hit.summary, historyQuery)}</div>
                    <div className="text-text-muted text-xs truncate">{highlightMatch(hit.snippet, historyQuery)}</div>
                    <div className="text-text-muted text-xs truncate">
                      {highlightMatch(hit.author, historyQuery)} · {highlightMatch(hit.oid.slice(0, 8), historyQuery)}
                    </div>
                  </div>
                  {isSelected && isLoadingCommit && (
                    <Loader2 size={12} className="animate-spin text-text-muted shrink-0" />
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
