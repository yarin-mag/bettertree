import { useEffect } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useViewStore } from "../store/viewStore";
import { useUiStore } from "../store/uiStore";
import { readSession, writeSession, type Session } from "../lib/session";

function currentSession(): Session {
  const { repos, activeRepoId } = useWorkspaceStore.getState();
  return {
    repoPath: repos.find((r) => r.id === activeRepoId)?.path ?? null,
    view: useViewStore.getState().activeView,
    selectedCommitOid: useUiStore.getState().selectedCommitOid,
  };
}

// On launch, reselect the repo, view and commit the user had open; afterwards
// keep the saved session up to date. Nothing is saved until the restore attempt
// has finished, so the empty startup state can never wipe the saved one.
export function useSessionRestore() {
  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let failed = false;
    const save = () => {
      if (!ready) {
        // After a failed repo-list load the saved session is kept as it was, and
        // saving resumes only once the user has picked a repo.
        if (!failed || useWorkspaceStore.getState().activeRepoId === null) return;
        ready = true;
      }
      writeSession(currentSession());
    };
    const unsubscribe = [
      useWorkspaceStore.subscribe(save),
      useViewStore.subscribe(save),
      useUiStore.subscribe(save),
    ];

    (async () => {
      let loaded = false;
      try {
        const saved = readSession();
        await useWorkspaceStore.getState().loadRepos();
        // StrictMode runs this effect twice; only the live run may touch any store.
        if (cancelled) return;
        loaded = true;
        const ws = useWorkspaceStore.getState();
        // A repo the user already picked beats the saved one.
        if (saved.repoPath && ws.activeRepoId === null) {
          const repo = ws.repos.find((r) => r.path === saved.repoPath);
          if (repo) {
            await ws.setActiveRepo(repo.id);
            const stillThere = !cancelled && useWorkspaceStore.getState().activeRepoId === repo.id;
            if (stillThere) {
              if (saved.view) useViewStore.getState().setActiveView(saved.view);
              const { commits } = useWorkspaceStore.getState();
              if (saved.selectedCommitOid && commits.some((c) => c.oid === saved.selectedCommitOid)) {
                useUiStore.getState().selectCommit(saved.selectedCommitOid);
              }
            }
          }
        }
      } catch {
        // restoring is best effort: fall through to the normal empty start
      } finally {
        if (loaded) {
          ready = true;
          if (!cancelled) save();
        } else if (!cancelled) {
          failed = true;
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe.forEach((u) => u());
    };
  }, []);
}
