import { Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { useUiStore } from "../store/uiStore";

export default function AdvancedSearch() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { selectedCommitOid, isLoadingCommit, selectCommit } = useUiStore();
  const {
    historyQuery,
    setHistoryQuery,
    authorFilter,
    setAuthorFilter,
    sinceFilter,
    setSinceFilter,
    untilFilter,
    setUntilFilter,
    advancedResults,
    isSearching,
    runAdvancedSearch,
  } = useSearchStore();

  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const handleSearch = () => {
    if (!activeRepo) return;
    runAdvancedSearch(activeRepo.path);
  };

  return (
    <div className="p-2 border-t border-border-subtle text-sm">
      <div className="text-xs uppercase text-text-muted mb-1">Search history</div>
      <input
        className="w-full px-2 py-1 bg-elevated border border-border-subtle rounded mb-1 text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Message or code..."
        value={historyQuery}
        onChange={(e) => setHistoryQuery(e.target.value)}
      />
      <input
        className="w-full px-2 py-1 bg-elevated border border-border-subtle rounded mb-1 text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Author"
        value={authorFilter}
        onChange={(e) => setAuthorFilter(e.target.value)}
      />
      <div className="flex gap-1 mb-1">
        <input
          type="date"
          className="flex-1 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary"
          value={sinceFilter}
          onChange={(e) => setSinceFilter(e.target.value)}
        />
        <input
          type="date"
          className="flex-1 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary"
          value={untilFilter}
          onChange={(e) => setUntilFilter(e.target.value)}
        />
      </div>
      <button
        className="w-full px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50 flex items-center justify-center gap-1.5"
        onClick={handleSearch}
        disabled={!activeRepo || isSearching}
      >
        {isSearching && <Loader2 size={14} className="animate-spin" />}
        {isSearching ? "Searching..." : "Search history"}
      </button>
      <div className="mt-2 flex flex-col gap-1 max-h-56 overflow-y-auto">
        {advancedResults.map((hit) => {
          const isSelected = hit.oid === selectedCommitOid;
          return (
            <div
              key={hit.oid}
              data-testid="search-hit"
              onClick={() => selectCommit(hit.oid)}
              className={`px-1 py-0.5 border-b border-border-subtle cursor-pointer rounded flex items-center justify-between gap-1 ${
                isSelected ? "bg-accent-soft text-accent" : "hover:bg-hover"
              }`}
            >
              <div className="min-w-0">
                <div className="font-medium truncate text-text-primary">{hit.summary}</div>
                <div className="text-text-muted text-xs truncate">{hit.snippet}</div>
              </div>
              {isSelected && isLoadingCommit && (
                <Loader2 size={12} className="animate-spin text-text-muted shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
