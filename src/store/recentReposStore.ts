import { create } from "zustand";

export interface ClosedRepo {
  path: string;
  name: string;
  closedAt: number;
}

const STORAGE_KEY = "workspace.recentlyClosed";
const MAX_RECENT = 5;

function load(): ClosedRepo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(list: ClosedRepo[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // best-effort; a full/blocked localStorage shouldn't break closing a repo
  }
}

interface RecentReposState {
  recentlyClosed: ClosedRepo[];
  addClosed: (repo: { path: string; name: string }) => void;
  removeClosed: (path: string) => void;
}

export const useRecentReposStore = create<RecentReposState>((set, get) => ({
  recentlyClosed: load(),

  addClosed: (repo) => {
    const withoutDupe = get().recentlyClosed.filter((r) => r.path !== repo.path);
    const recentlyClosed = [{ ...repo, closedAt: Date.now() }, ...withoutDupe].slice(0, MAX_RECENT);
    save(recentlyClosed);
    set({ recentlyClosed });
  },

  removeClosed: (path) => {
    const recentlyClosed = get().recentlyClosed.filter((r) => r.path !== path);
    save(recentlyClosed);
    set({ recentlyClosed });
  },
}));
