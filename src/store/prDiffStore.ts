import { create } from "zustand";
import {
  invokeGetPrDiff,
  invokeListPrReviewComments,
  invokeAddPrReviewComment,
  type PrDiff,
  type PrReviewComment,
} from "../lib/tauri";

interface PrDiffState {
  diff: PrDiff | null;
  reviewComments: PrReviewComment[];
  isLoadingDiff: boolean;
  loadDiff: (repoPath: string, number: number, baseRefName: string) => Promise<void>;
  addReviewComment: (
    repoPath: string,
    number: number,
    path: string,
    line: number,
    side: "LEFT" | "RIGHT",
    body: string
  ) => Promise<void>;
  clearDiff: () => void;
}

export const usePrDiffStore = create<PrDiffState>((set, get) => ({
  diff: null,
  reviewComments: [],
  isLoadingDiff: false,
  loadDiff: async (repoPath, number, baseRefName) => {
    set({ isLoadingDiff: true });
    try {
      const [diff, reviewComments] = await Promise.all([
        invokeGetPrDiff(repoPath, number, baseRefName),
        invokeListPrReviewComments(repoPath, number),
      ]);
      set({ diff, reviewComments });
    } finally {
      set({ isLoadingDiff: false });
    }
  },
  addReviewComment: async (repoPath, number, path, line, side, body) => {
    const comment = await invokeAddPrReviewComment(repoPath, number, path, line, side, body);
    set({ reviewComments: [...get().reviewComments, comment] });
  },
  clearDiff: () => set({ diff: null, reviewComments: [] }),
}));
