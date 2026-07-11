import { create } from "zustand";
import {
  invokeGetStatus,
  invokeStageFile,
  invokeUnstageFile,
  invokeCommitChanges,
  type StatusEntry,
} from "../lib/tauri";

interface WorkingCopyState {
  status: StatusEntry[];
  commitMessage: string;
  setCommitMessage: (message: string) => void;
  refreshStatus: (repoPath: string) => Promise<void>;
  stage: (repoPath: string, filePath: string) => Promise<void>;
  unstage: (repoPath: string, filePath: string) => Promise<void>;
  commit: (repoPath: string) => Promise<void>;
}

export const useWorkingCopyStore = create<WorkingCopyState>((set, get) => ({
  status: [],
  commitMessage: "",
  setCommitMessage: (commitMessage: string) => set({ commitMessage }),

  refreshStatus: async (repoPath: string) => {
    const status = await invokeGetStatus(repoPath);
    set({ status });
  },

  stage: async (repoPath: string, filePath: string) => {
    await invokeStageFile(repoPath, filePath);
    await get().refreshStatus(repoPath);
  },

  unstage: async (repoPath: string, filePath: string) => {
    await invokeUnstageFile(repoPath, filePath);
    await get().refreshStatus(repoPath);
  },

  commit: async (repoPath: string) => {
    const { commitMessage } = get();
    await invokeCommitChanges(repoPath, commitMessage);
    set({ commitMessage: "" });
    await get().refreshStatus(repoPath);
  },
}));
