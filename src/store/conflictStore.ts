import { create } from "zustand";
import { invokeListConflictedFiles, ConflictedFile } from "../lib/tauri";

interface ConflictStoreState {
  files: ConflictedFile[];
  inProgress: boolean;
  operation: "merge" | "rebase" | null;
  panelOpen: boolean;
  refresh: (repoPath: string) => Promise<void>;
  reset: () => void;
  openPanel: () => void;
  closePanel: () => void;
}

// Guards against an older (slower) query overwriting a newer result, e.g.
// after switching repos mid-request.
let latestRequest = 0;

const EMPTY = { files: [] as ConflictedFile[], inProgress: false, operation: null };

export const useConflictStore = create<ConflictStoreState>((set) => ({
  ...EMPTY,
  panelOpen: false,

  refresh: async (repoPath: string) => {
    const request = ++latestRequest;
    try {
      const result = await invokeListConflictedFiles(repoPath);
      if (request !== latestRequest) return;
      set({ files: result.files, inProgress: result.inProgress, operation: result.operation });
    } catch {
      // A failed status query must never surface as an error banner; treat as "no conflicts".
      if (request !== latestRequest) return;
      set(EMPTY);
    }
  },

  reset: () => {
    latestRequest++;
    set({ ...EMPTY, panelOpen: false });
  },

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
}));

export function isConflictError(e: unknown): boolean {
  return /merge conflicts?|CONFLICT/i.test(String(e));
}
