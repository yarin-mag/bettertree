import { create } from "zustand";

export interface CiPrefs {
  names: Record<number, string>;
  favorites: number[];
  favoritesOnly: boolean;
  badgeFollowsFavorites: boolean;
}

const STORAGE_KEY = "ciPrefs";
const makeDefaults = (): CiPrefs => ({ names: {}, favorites: [], favoritesOnly: false, badgeFollowsFavorites: true });

// Per-repo memo so getPrefs is referentially stable while the stored entry is unchanged.
const cache = new Map<string, { source: CiPrefs | undefined; value: CiPrefs }>();

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function sanitize(v: unknown): CiPrefs {
  const e = isObj(v) ? v : {};
  return {
    names: isObj(e.names) ? (e.names as Record<number, string>) : {},
    favorites: Array.isArray(e.favorites) ? e.favorites.filter((n): n is number => typeof n === "number") : [],
    favoritesOnly: typeof e.favoritesOnly === "boolean" ? e.favoritesOnly : false,
    badgeFollowsFavorites: typeof e.badgeFollowsFavorites === "boolean" ? e.badgeFollowsFavorites : true,
  };
}

function load(): Record<string, CiPrefs> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!isObj(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, sanitize(v)]));
  } catch {
    return {};
  }
}

interface State {
  prefs: Record<string, CiPrefs>;
  getPrefs: (repoPath: string) => CiPrefs;
  setName: (repoPath: string, workflowId: number, name: string) => void;
  toggleFavorite: (repoPath: string, workflowId: number) => void;
  setFavoritesOnly: (repoPath: string, on: boolean) => void;
  setBadgeFollowsFavorites: (repoPath: string, on: boolean) => void;
}

export const useCiPrefsStore = create<State>((set, get) => {
  const update = (repoPath: string, patch: (p: CiPrefs) => CiPrefs) => {
    const next = { ...get().prefs, [repoPath]: patch(get().getPrefs(repoPath)) };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: applies for this session only
    }
    set({ prefs: next });
  };
  return {
    prefs: load(),
    getPrefs: (repoPath) => {
      const source = get().prefs[repoPath];
      const hit = cache.get(repoPath);
      if (hit && hit.source === source) return hit.value;
      const value = { ...makeDefaults(), ...source };
      cache.set(repoPath, { source, value });
      return value;
    },
    setName: (repoPath, workflowId, name) =>
      update(repoPath, (p) => {
        const names = { ...p.names };
        if (name.trim()) names[workflowId] = name.trim();
        else delete names[workflowId];
        return { ...p, names };
      }),
    toggleFavorite: (repoPath, workflowId) =>
      update(repoPath, (p) => ({
        ...p,
        favorites: p.favorites.includes(workflowId) ? p.favorites.filter((f) => f !== workflowId) : [...p.favorites, workflowId],
      })),
    setFavoritesOnly: (repoPath, favoritesOnly) => update(repoPath, (p) => ({ ...p, favoritesOnly })),
    setBadgeFollowsFavorites: (repoPath, badgeFollowsFavorites) => update(repoPath, (p) => ({ ...p, badgeFollowsFavorites })),
  };
});
