import { create } from "zustand";

interface UiState {
  selectedCommitOid: string | null;
  selectCommit: (oid: string | null) => void;
  isLoadingCommit: boolean;
  setLoadingCommit: (isLoadingCommit: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedCommitOid: null,
  selectCommit: (selectedCommitOid: string | null) => set({ selectedCommitOid }),
  isLoadingCommit: false,
  setLoadingCommit: (isLoadingCommit: boolean) => set({ isLoadingCommit }),
}));
