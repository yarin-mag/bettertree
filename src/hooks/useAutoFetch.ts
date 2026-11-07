import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { invokeFetchRemote } from "../lib/tauri";
import { toast } from "../store/toastStore";

export const AUTO_FETCH_INTERVAL_MS = 60_000;
export const AUTO_FETCH_MAX_BACKOFF_MS = 10 * 60_000;
export const FETCH_FLASH_MS = 900;

export function nextFetchDelay(consecutiveFailures: number): number {
  return Math.min(AUTO_FETCH_INTERVAL_MS * 2 ** consecutiveFailures, AUTO_FETCH_MAX_BACKOFF_MS);
}

// Fetches the active repo on a timer and on demand. A background fetch only
// reloads branch/graph data when the fetched refs actually changed, so
// polling never resets the commit list when nothing new arrived. A manual
// fetch always reloads. Failures are surfaced (marker + one toast per failure
// streak) and back the polling off exponentially until a fetch succeeds.
export function useAutoFetch(repoId: number | null, repoPath: string | undefined) {
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [justFetched, setJustFetched] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const failures = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLastFetchedAt(null);
    setJustFetched(false);
    setFetchError(null);
    failures.current = 0;
  }, [repoPath]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const fetchNow = useCallback(
    async (manual: boolean) => {
      if (!repoPath || repoId === null || inFlight.current) return;
      inFlight.current = true;
      setIsFetching(true);
      try {
        // Re-read the local branches first: a branch switched outside the app
        // must show up even when the network fetch below fails or hangs.
        if (!manual) await useWorkspaceStore.getState().syncActiveRepo(repoPath).catch(() => {});
        await invokeFetchRemote(repoPath);
        const store = useWorkspaceStore.getState();
        if (manual) {
          await store.setActiveRepo(repoId);
        } else {
          await store.syncActiveRepo(repoPath);
        }
        failures.current = 0;
        setFetchError(null);
        setLastFetchedAt(Date.now());
        setJustFetched(true);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setJustFetched(false), FETCH_FLASH_MS);
      } catch (e) {
        const message = String(e);
        failures.current += 1;
        setFetchError(message);
        // One toast per failure streak, so a dead remote doesn't spam.
        if (failures.current === 1) toast.error(`Fetch failed: ${message}`);
        throw e;
      } finally {
        inFlight.current = false;
        setIsFetching(false);
      }
    },
    [repoId, repoPath]
  );

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState !== "hidden") {
          await fetchNow(false).catch(() => {});
        }
        if (!cancelled) schedule();
      }, nextFetchDelay(failures.current));
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [repoPath, fetchNow]);

  return { lastFetchedAt, isFetching, justFetched, fetchError, fetchNow };
}
