import { create } from "zustand";

export interface DirtyCheckoutTarget {
  kind: "branch" | "tag";
  name: string;
  isRemote: boolean;
  /** The backend's explanation, shown at the top of the dialog. */
  reason: string;
}

// Set when a checkout was blocked by uncommitted changes; drives the dialog
// that offers stash / discard / worktree.
interface DirtyCheckoutState {
  target: DirtyCheckoutTarget | null;
  open: (target: DirtyCheckoutTarget) => void;
  close: () => void;
}

export const useDirtyCheckoutStore = create<DirtyCheckoutState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
