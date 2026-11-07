import { create } from "zustand";

export interface SearchFilters {
  historyQuery: string;
  authorFilter: string;
  sinceFilter: string;
  untilFilter: string;
  commitIdFilter: string;
  filePathFilter: string;
}

export interface RecentSearch {
  filters: SearchFilters;
  timestamp: number;
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: SearchFilters;
}

export const EMPTY_FILTERS: SearchFilters = {
  historyQuery: "",
  authorFilter: "",
  sinceFilter: "",
  untilFilter: "",
  commitIdFilter: "",
  filePathFilter: "",
};

const FILTERS_KEY = "search.filters";
const RECENT_KEY = "search.recent";
const SAVED_KEY = "search.saved";
const MAX_RECENT = 10;

function isFilters(v: unknown): v is SearchFilters {
  if (!v || typeof v !== "object") return false;
  return (Object.keys(EMPTY_FILTERS) as (keyof SearchFilters)[]).every(
    (k) => typeof (v as Record<string, unknown>)[k] === "string"
  );
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the value still applies for this session
  }
}

export function loadFilters(): SearchFilters {
  const v = readJson(FILTERS_KEY);
  return isFilters(v) ? { ...EMPTY_FILTERS, ...v } : { ...EMPTY_FILTERS };
}

export function saveFilters(filters: SearchFilters) {
  writeJson(FILTERS_KEY, filters);
}

export function sameFilters(a: SearchFilters, b: SearchFilters): boolean {
  return (Object.keys(EMPTY_FILTERS) as (keyof SearchFilters)[]).every((k) => a[k] === b[k]);
}

export function hasAnyFilter(f: SearchFilters): boolean {
  return !sameFilters(f, EMPTY_FILTERS);
}

function initialRecent(): RecentSearch[] {
  const v = readJson(RECENT_KEY);
  if (!Array.isArray(v)) return [];
  return v
    .filter((e) => e && isFilters(e.filters) && typeof e.timestamp === "number")
    .slice(0, MAX_RECENT);
}

function initialSaved(): SavedSearch[] {
  const v = readJson(SAVED_KEY);
  if (!Array.isArray(v)) return [];
  return v.filter(
    (e) => e && typeof e.id === "string" && typeof e.name === "string" && isFilters(e.filters)
  );
}

interface SavedSearchState {
  recent: RecentSearch[];
  saved: SavedSearch[];
  addRecent: (filters: SearchFilters) => void;
  removeRecent: (index: number) => void;
  clearRecent: () => void;
  saveSearch: (name: string, filters: SearchFilters) => void;
  removeSaved: (id: string) => void;
}

export const useSavedSearchStore = create<SavedSearchState>((set, get) => ({
  recent: initialRecent(),
  saved: initialSaved(),

  addRecent: (filters) => {
    if (!hasAnyFilter(filters)) return;
    const recent = [
      { filters: { ...filters }, timestamp: Date.now() },
      ...get().recent.filter((r) => !sameFilters(r.filters, filters)),
    ].slice(0, MAX_RECENT);
    writeJson(RECENT_KEY, recent);
    set({ recent });
  },
  removeRecent: (index) => {
    const recent = get().recent.filter((_, i) => i !== index);
    writeJson(RECENT_KEY, recent);
    set({ recent });
  },
  clearRecent: () => {
    writeJson(RECENT_KEY, []);
    set({ recent: [] });
  },

  saveSearch: (name, filters) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: trimmed, filters: { ...filters } };
    // Saving under an existing name replaces it.
    const saved = [entry, ...get().saved.filter((s) => s.name !== trimmed)];
    writeJson(SAVED_KEY, saved);
    set({ saved });
  },
  removeSaved: (id) => {
    const saved = get().saved.filter((s) => s.id !== id);
    writeJson(SAVED_KEY, saved);
    set({ saved });
  },
}));

export function describeFilters(f: SearchFilters): string {
  const parts: string[] = [];
  if (f.historyQuery) parts.push(f.historyQuery);
  if (f.authorFilter) parts.push(`author:${f.authorFilter}`);
  if (f.commitIdFilter) parts.push(`sha:${f.commitIdFilter}`);
  if (f.filePathFilter) parts.push(`file:${f.filePathFilter}`);
  if (f.sinceFilter) parts.push(`since:${f.sinceFilter}`);
  if (f.untilFilter) parts.push(`until:${f.untilFilter}`);
  return parts.join(" ");
}
