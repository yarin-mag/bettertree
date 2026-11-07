import { create } from "zustand";
import { invokeCiCommitChecks, invokeCiRerun, invokeCiCancel, type CommitChecks } from "../lib/tauri";
import { classifyCiError, type CiErrorKind } from "../lib/ciErrors";
import { toast } from "./toastStore";
import { useCiStatusStore } from "./ciStatusStore";

export const CI_CHECKS_POLL_MS = 15_000;

interface State {
  repoPath: string | null;
  oid: string | null;
  checks: CommitChecks | null;
  loading: boolean;
  error: { kind: CiErrorKind; message: string } | null;
  load: (repoPath: string, oid: string) => Promise<void>;
  refresh: () => Promise<void>;
  rerun: (runId: number, failedOnly: boolean) => Promise<void>;
  cancel: (runId: number) => Promise<void>;
}

export const useCiChecksStore = create<State>((set, get) => ({
  repoPath: null,
  oid: null,
  checks: null,
  loading: false,
  error: null,
  load: async (repoPath, oid) => {
    set({ repoPath, oid, loading: true, error: null, checks: get().oid === oid ? get().checks : null });
    try {
      const checks = await invokeCiCommitChecks(repoPath, oid);
      if (get().oid !== oid) return;
      set({ checks, loading: false });
    } catch (e) {
      if (get().oid !== oid) return;
      const message = String(e);
      set({ loading: false, error: { kind: classifyCiError(message).kind, message } });
    }
  },
  refresh: async () => {
    const { repoPath, oid } = get();
    if (repoPath && oid) {
      await get().load(repoPath, oid);
      void useCiStatusStore.getState().refresh(repoPath, [oid]);
    }
  },
  rerun: async (runId, failedOnly) => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      await invokeCiRerun(repoPath, runId, failedOnly);
      toast.success(failedOnly ? "Re-running failed jobs" : "Re-running workflow");
      await get().refresh();
    } catch (e) {
      toast.error(`Re-run failed: ${e}`);
    }
  },
  cancel: async (runId) => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      await invokeCiCancel(repoPath, runId);
      toast.success("Cancelling workflow");
      await get().refresh();
    } catch (e) {
      toast.error(`Cancel failed: ${e}`);
    }
  },
}));
