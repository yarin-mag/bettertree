import { create } from "zustand";
import { DEFAULT_REPO_SETTINGS, type RepoSettings } from "../lib/repoSettings";
import { invokeGetRepoSettings, invokeSetRepoSettings, invokeResetRepoSettings } from "../lib/tauri";
import { toast } from "./toastStore";

interface RepoSettingsState {
  /** Settings by repo path; a path is absent until its first load. */
  byPath: Record<string, RepoSettings>;
  load: (path: string) => Promise<void>;
  /** Saves and caches the value the backend stored (it may normalize it). Throws on failure. */
  save: (path: string, settings: RepoSettings) => Promise<RepoSettings>;
  reset: (path: string) => Promise<void>;
}

// Loads currently in flight, so concurrent callers share one request (and one failure toast).
const inflight = new Map<string, Promise<void>>();

export const useRepoSettingsStore = create<RepoSettingsState>((set, get) => ({
  byPath: {},
  load: (path) => {
    if (get().byPath[path]) return Promise.resolve();
    const pending = inflight.get(path);
    if (pending) return pending;
    const request = (async () => {
      try {
        const settings = await invokeGetRepoSettings(path);
        // A save/reset that finished while this was in flight is newer; keep it.
        set((s) => (s.byPath[path] ? s : { byPath: { ...s.byPath, [path]: settings } }));
      } catch (e) {
        // Cache the defaults so a failing load is not retried on every render.
        set((s) => (s.byPath[path] ? s : { byPath: { ...s.byPath, [path]: DEFAULT_REPO_SETTINGS } }));
        toast.error(`Couldn't load repo settings: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        inflight.delete(path);
      }
    })();
    inflight.set(path, request);
    return request;
  },
  save: async (path, settings) => {
    const stored = await invokeSetRepoSettings(path, settings);
    set((s) => ({ byPath: { ...s.byPath, [path]: stored } }));
    return stored;
  },
  reset: async (path) => {
    await invokeResetRepoSettings(path);
    set((s) => ({ byPath: { ...s.byPath, [path]: DEFAULT_REPO_SETTINGS } }));
  },
}));
