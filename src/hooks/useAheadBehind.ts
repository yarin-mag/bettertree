import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { invokeGetAheadBehind, type AheadBehind } from "../lib/tauri";

/**
 * Ahead/behind of the current branch versus its upstream for `repoPath`.
 * Reloads whenever branches/HEAD change in the workspace store (which happens
 * after fetch, pull and checkout). Failures are silent; stale responses from a
 * previous repo or an older request are discarded.
 */
export function useAheadBehind(repoPath: string | undefined): AheadBehind | null {
  const branches = useWorkspaceStore((s) => s.branches);
  const headOid = useWorkspaceStore((s) => s.headOid);
  const [state, setState] = useState<{ repoPath: string; value: AheadBehind | null } | null>(null);

  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    invokeGetAheadBehind(repoPath)
      .then((value) => {
        if (!cancelled) setState({ repoPath, value });
      })
      .catch(() => {
        if (!cancelled) setState({ repoPath, value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, branches, headOid]);

  return repoPath && state?.repoPath === repoPath ? state.value : null;
}
