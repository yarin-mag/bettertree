import { create } from "zustand";
import { invokeCiStatusForCommits, type CommitCi } from "../lib/tauri";
import { toast } from "./toastStore";
import { classifyCiError, shortCiError } from "../lib/ciErrors";

export const CI_POLL_MS = 30_000;
export const NONE_RECHECK_MS = 60_000;
const DEBOUNCE_MS = 300;

interface State {
  byOid: Record<string, CommitCi>;
  request: (repoPath: string, oids: string[]) => void;
  refresh: (repoPath: string, oids: string[]) => Promise<void>;
}

let wanted = new Set<string>();
let debounce: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight = new Set<string>();
let failureStreak = 0;
let activeRepo = "";
let fetchedAt = new Map<string, number>();

export function resetCiStatus() {
  clearTimeout(debounce);
  clearTimeout(pollTimer);
  wanted = new Set();
  inFlight = new Set();
  failureStreak = 0;
  activeRepo = "";
  fetchedAt = new Map();
  useCiStatusStore.setState({ byOid: {} });
}

export const useCiStatusStore = create<State>((set, get) => {
  // Make `repoPath` the active repo; on a switch, drop everything belonging to the old one.
  const activate = (repoPath: string) => {
    if (repoPath === activeRepo) return;
    activeRepo = repoPath;
    clearTimeout(debounce);
    clearTimeout(pollTimer);
    wanted = new Set();
    inFlight = new Set();
    failureStreak = 0;
    fetchedAt = new Map();
    set({ byOid: {} });
  };

  const fetchOids = async (repoPath: string, oids: string[]) => {
    if (repoPath !== activeRepo) return;
    const todo = oids.filter((o) => !inFlight.has(o));
    if (todo.length === 0) return;
    const flight = inFlight;
    todo.forEach((o) => flight.add(o));
    try {
      const results = await invokeCiStatusForCommits(repoPath, todo);
      if (repoPath !== activeRepo) return; // repo switched while in flight: stale
      failureStreak = 0;
      const next = { ...get().byOid };
      const now = Date.now();
      for (const r of results) { next[r.oid] = r; fetchedAt.set(r.oid, now); }
      set({ byOid: next });
    } catch (e) {
      if (repoPath !== activeRepo) return;
      // Badges degrade to "none"; one toast per failure streak.
      failureStreak += 1;
      if (failureStreak === 1 && classifyCiError(String(e)).kind !== "no-gh") toast.error(`CI status unavailable: ${shortCiError(String(e))}`);
    } finally {
      todo.forEach((o) => flight.delete(o));
      if (repoPath === activeRepo) schedulePoll(repoPath);
    }
  };

  const schedulePoll = (repoPath: string) => {
    clearTimeout(pollTimer);
    const pending = Object.values(get().byOid).filter((c) => c.state === "pending").map((c) => c.oid);
    if (pending.length === 0) return;
    pollTimer = setTimeout(() => {
      if (repoPath !== activeRepo) return;
      if (document.visibilityState === "hidden") return schedulePoll(repoPath);
      const still = Object.values(get().byOid).filter((c) => c.state === "pending").map((c) => c.oid);
      void fetchOids(repoPath, still);
    }, CI_POLL_MS);
  };

  return {
    byOid: {},
    request: (repoPath, oids) => {
      activate(repoPath);
      const known = get().byOid;
      const now = Date.now();
      oids.forEach((o) => {
        const c = known[o];
        if (!c || (c.state === "none" && now - (fetchedAt.get(o) ?? 0) >= NONE_RECHECK_MS)) wanted.add(o);
      });
      if (wanted.size === 0) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const batch = [...wanted];
        wanted = new Set();
        void fetchOids(repoPath, batch);
      }, DEBOUNCE_MS);
    },
    refresh: (repoPath, oids) => {
      activate(repoPath);
      return fetchOids(repoPath, oids);
    },
  };
});
