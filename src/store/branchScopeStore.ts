import { create } from "zustand";

interface BranchScopeState {
  showRemoteBranches: boolean;
  toggleShowRemoteBranches: () => void;
}

function applyShowRemoteBranches(value: boolean) {
  localStorage.setItem("branchScope.showRemoteBranches", String(value));
}

function initialShowRemoteBranches(): boolean {
  return localStorage.getItem("branchScope.showRemoteBranches") !== "false";
}

export const useBranchScopeStore = create<BranchScopeState>((set, get) => ({
  showRemoteBranches: initialShowRemoteBranches(),
  toggleShowRemoteBranches: () => {
    const next = !get().showRemoteBranches;
    applyShowRemoteBranches(next);
    set({ showRemoteBranches: next });
  },
}));
