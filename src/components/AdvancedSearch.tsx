import { useState } from "react";
import { Loader2, Pin, Clock, X } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import {
  useSavedSearchStore,
  describeFilters,
  hasAnyFilter,
  type SearchFilters,
} from "../store/savedSearchStore";

export default function AdvancedSearch() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const {
    historyQuery,
    setHistoryQuery,
    authorFilter,
    setAuthorFilter,
    sinceFilter,
    setSinceFilter,
    untilFilter,
    setUntilFilter,
    commitIdFilter,
    setCommitIdFilter,
    filePathFilter,
    setFilePathFilter,
    isSearching,
    runAdvancedSearch,
    applyFilters,
    clearFilters,
  } = useSearchStore();
  const { recent, saved, removeRecent, clearRecent, saveSearch, removeSaved } = useSavedSearchStore();
  const [savingName, setSavingName] = useState<string | null>(null);

  const current: SearchFilters = {
    historyQuery,
    authorFilter,
    sinceFilter,
    untilFilter,
    commitIdFilter,
    filePathFilter,
  };
  const anyFilter = hasAnyFilter(current);

  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const handleSearch = () => {
    if (!activeRepo) return;
    runAdvancedSearch(activeRepo.path);
  };

  const applyAndRun = (filters: SearchFilters) => {
    applyFilters(filters);
    if (activeRepo) runAdvancedSearch(activeRepo.path);
  };

  const commitSave = () => {
    if (savingName && savingName.trim()) saveSearch(savingName, current);
    setSavingName(null);
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
      <input
        className="w-full px-2 py-1 bg-elevated border border-border-subtle rounded mb-1 text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Commit SHA..."
        value={commitIdFilter}
        onChange={(e) => setCommitIdFilter(e.target.value)}
      />
      <input
        className="w-full px-2 py-1 bg-elevated border border-border-subtle rounded mb-1 text-text-primary outline-none placeholder:text-text-muted"
        placeholder="File path..."
        value={filePathFilter}
        onChange={(e) => setFilePathFilter(e.target.value)}
      />
      <button
        className="w-full px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50 flex items-center justify-center gap-1.5"
        onClick={handleSearch}
        disabled={!activeRepo || isSearching}
      >
        {isSearching && <Loader2 size={14} className="animate-spin" />}
        {isSearching ? "Searching..." : "Search history"}
      </button>
      <div className="flex gap-1 mt-1">
        <button
          type="button"
          className="flex-1 px-2 py-1 text-xs text-text-muted hover:bg-hover hover:text-text-primary rounded disabled:opacity-50"
          onClick={clearFilters}
          disabled={!anyFilter}
        >
          Clear filters
        </button>
        <button
          type="button"
          className="flex-1 px-2 py-1 text-xs text-text-muted hover:bg-hover hover:text-text-primary rounded disabled:opacity-50"
          onClick={() => setSavingName("")}
          disabled={!anyFilter || savingName !== null}
        >
          Save search
        </button>
      </div>
      {savingName !== null && (
        <input
          autoFocus
          className="w-full px-2 py-1 mt-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none placeholder:text-text-muted"
          placeholder="Name this search, Enter to save"
          value={savingName}
          onChange={(e) => setSavingName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSave();
            else if (e.key === "Escape") {
              e.stopPropagation();
              setSavingName(null);
            }
          }}
          onBlur={commitSave}
        />
      )}
      {saved.length > 0 && (
        <div className="mt-2">
          <div className="text-xs uppercase text-text-muted mb-1">Saved searches</div>
          {saved.map((s) => (
            <div key={s.id} className="group flex items-center gap-1 hover:bg-hover rounded">
              <button
                type="button"
                className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 text-left text-text-primary"
                title={describeFilters(s.filters)}
                onClick={() => applyAndRun(s.filters)}
              >
                <Pin size={12} className="text-accent shrink-0" />
                <span className="truncate">{s.name}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete saved search ${s.name}`}
                className="p-1 text-text-muted hover:text-text-primary shrink-0"
                onClick={() => removeSaved(s.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase text-text-muted">Recent searches</span>
            <button type="button" className="text-xs text-text-muted hover:text-text-primary" onClick={clearRecent}>
              Clear history
            </button>
          </div>
          {recent.map((r, i) => (
            <div key={r.timestamp + ":" + i} className="flex items-center gap-1 hover:bg-hover rounded">
              <button
                type="button"
                data-testid="recent-search"
                className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 text-left text-text-primary"
                title={describeFilters(r.filters)}
                onClick={() => applyAndRun(r.filters)}
              >
                <Clock size={12} className="text-text-muted shrink-0" />
                <span className="truncate">{describeFilters(r.filters)}</span>
              </button>
              <button
                type="button"
                aria-label={`Remove recent search ${describeFilters(r.filters)}`}
                className="p-1 text-text-muted hover:text-text-primary shrink-0"
                onClick={() => removeRecent(i)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
