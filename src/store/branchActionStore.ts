import { create } from "zustand";

// Drives the "Create branch here" dialog, which can be opened from a commit
// row or a branch row.
interface BranchActionState {
  createBranchTarget: { oid: string; label: string } | null;
  openCreateBranch: (oid: string, label: string) => void;
  closeCreateBranch: () => void;
}

export const useBranchActionStore = create<BranchActionState>((set) => ({
  createBranchTarget: null,
  openCreateBranch: (oid, label) => set({ createBranchTarget: { oid, label } }),
  closeCreateBranch: () => set({ createBranchTarget: null }),
}));
