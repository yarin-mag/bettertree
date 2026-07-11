import { create } from "zustand";
import { invokeSearchCommits, type SearchHit } from "../lib/tauri";

interface SearchState {
  query: string;
  setQuery: (query: string) => void;

  historyQuery: string;
  setHistoryQuery: (q: string) => void;
  authorFilter: string;
  setAuthorFilter: (a: string) => void;
  sinceFilter: string;
  setSinceFilter: (d: string) => void;
  untilFilter: string;
  setUntilFilter: (d: string) => void;
  advancedResults: SearchHit[];
  isSearching: boolean;
  runAdvancedSearch: (repoPath: string) => Promise<void>;
}

function dateToUnixSeconds(dateStr: string): number | undefined {
  if (!dateStr) return undefined;
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

let latestSearchId = 0;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  setQuery: (query: string) => set({ query }),

  historyQuery: "",
  setHistoryQuery: (historyQuery: string) => set({ historyQuery }),
  authorFilter: "",
  setAuthorFilter: (authorFilter: string) => set({ authorFilter }),
  sinceFilter: "",
  setSinceFilter: (sinceFilter: string) => set({ sinceFilter }),
  untilFilter: "",
  setUntilFilter: (untilFilter: string) => set({ untilFilter }),
  advancedResults: [],
  isSearching: false,

  runAdvancedSearch: async (repoPath: string) => {
    const { historyQuery, authorFilter, sinceFilter, untilFilter } = get();
    const searchId = ++latestSearchId;
    set({ isSearching: true });
    try {
      const results = await invokeSearchCommits(
        repoPath,
        historyQuery,
        authorFilter || undefined,
        dateToUnixSeconds(sinceFilter),
        dateToUnixSeconds(untilFilter)
      );
      if (searchId !== latestSearchId) return;
      set({ advancedResults: results });
    } finally {
      if (searchId === latestSearchId) set({ isSearching: false });
    }
  },
}));
