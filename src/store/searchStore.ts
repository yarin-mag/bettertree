import { create } from "zustand";
import { invokeSearchCommits, type SearchHit } from "../lib/tauri";
import {
  EMPTY_FILTERS,
  loadFilters,
  saveFilters,
  useSavedSearchStore,
  type SearchFilters,
} from "./savedSearchStore";

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
  commitIdFilter: string;
  setCommitIdFilter: (id: string) => void;
  filePathFilter: string;
  setFilePathFilter: (path: string) => void;
  applyFilters: (filters: SearchFilters) => void;
  clearFilters: () => void;
  advancedResults: SearchHit[];
  isSearching: boolean;
  runAdvancedSearch: (repoPath: string) => Promise<void>;

  isSearchActive: boolean;
  activateSearch: () => void;
  deactivateSearch: () => void;
}

function dateToUnixSeconds(dateStr: string): number | undefined {
  if (!dateStr) return undefined;
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

let latestSearchId = 0;

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof SearchFilters)[];

function pickFilters(state: SearchFilters): SearchFilters {
  const out = { ...EMPTY_FILTERS };
  for (const k of FILTER_KEYS) out[k] = state[k];
  return out;
}

// Sets one filter field and persists the whole filter set.
function setFilter(
  set: (partial: Partial<SearchFilters>) => void,
  get: () => SearchFilters,
  key: keyof SearchFilters,
  value: string
) {
  set({ [key]: value });
  saveFilters(pickFilters({ ...get(), [key]: value }));
}

export const useSearchStore = create<SearchState>((set, get) => ({
  ...loadFilters(),
  query: "",
  setQuery: (query: string) => set({ query }),

  setHistoryQuery: (historyQuery: string) => setFilter(set, get, "historyQuery", historyQuery),
  setAuthorFilter: (authorFilter: string) => setFilter(set, get, "authorFilter", authorFilter),
  setSinceFilter: (sinceFilter: string) => setFilter(set, get, "sinceFilter", sinceFilter),
  setUntilFilter: (untilFilter: string) => setFilter(set, get, "untilFilter", untilFilter),
  setCommitIdFilter: (commitIdFilter: string) => setFilter(set, get, "commitIdFilter", commitIdFilter),
  setFilePathFilter: (filePathFilter: string) => setFilter(set, get, "filePathFilter", filePathFilter),
  applyFilters: (filters) => {
    const next = pickFilters(filters);
    set(next);
    saveFilters(next);
  },
  clearFilters: () => {
    set({ ...EMPTY_FILTERS });
    saveFilters({ ...EMPTY_FILTERS });
  },
  advancedResults: [],
  isSearching: false,

  runAdvancedSearch: async (repoPath: string) => {
    const { historyQuery, authorFilter, sinceFilter, untilFilter, commitIdFilter, filePathFilter } = get();
    const searchId = ++latestSearchId;
    set({ isSearching: true });
    try {
      const results = await invokeSearchCommits(
        repoPath,
        historyQuery,
        authorFilter || undefined,
        dateToUnixSeconds(sinceFilter),
        dateToUnixSeconds(untilFilter),
        commitIdFilter || undefined,
        filePathFilter || undefined
      );
      if (searchId !== latestSearchId) return;
      set({ advancedResults: results });
      useSavedSearchStore
        .getState()
        .addRecent({ historyQuery, authorFilter, sinceFilter, untilFilter, commitIdFilter, filePathFilter });
    } finally {
      if (searchId === latestSearchId) set({ isSearching: false });
    }
  },

  isSearchActive: false,
  activateSearch: () => set({ isSearchActive: true }),
  deactivateSearch: () => set({ isSearchActive: false }),
}));
