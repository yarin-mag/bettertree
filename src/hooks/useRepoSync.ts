import { useEffect } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";

// Focus and visibility events often arrive together (and several times while
// switching apps), so syncs closer together than this are skipped.
export const REPO_SYNC_THROTTLE_MS = 1000;

// Re-reads the active repo from disk whenever the window is brought back, so a
// branch switched in a terminal while Bettertree was in the background shows up
// right away instead of waiting for the next background poll.
export function useRepoSync(repoPath: string | undefined) {
  useEffect(() => {
    if (!repoPath) return;
    let last = 0;
    const sync = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - last < REPO_SYNC_THROTTLE_MS) return;
      last = now;
      useWorkspaceStore
        .getState()
        .syncActiveRepo(repoPath)
        .catch(() => {});
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [repoPath]);
}
