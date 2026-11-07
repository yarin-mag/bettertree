import { Search, History } from "lucide-react";
import { useSearchStore } from "../store/searchStore";

export default function SearchBar() {
  const { query, setQuery, isSearchActive, activateSearch, deactivateSearch } = useSearchStore();
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface border-b border-border-subtle">
      <Search size={14} className="text-text-muted shrink-0" />
      <input
        className="flex-1 bg-elevated border border-border-subtle rounded px-2 py-1 text-sm text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Search branches, tags, commits..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button
        type="button"
        title={isSearchActive ? "Back to commits" : "Search commit history"}
        aria-label="Search commit history"
        className={`p-1.5 rounded hover:bg-hover ${isSearchActive ? "text-accent" : "text-text-muted"} hover:text-text-primary shrink-0`}
        onClick={isSearchActive ? deactivateSearch : activateSearch}
      >
        <History size={14} />
      </button>
    </div>
  );
}
