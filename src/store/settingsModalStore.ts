import { create } from "zustand";

// Drives the Settings modal so it can be opened from the sidebar gear or a
// repo's right-click menu, optionally with a repo preselected.
interface SettingsModalState {
  isOpen: boolean;
  repoPath: string | null;
  open: (repoPath?: string | null) => void;
  close: () => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  isOpen: false,
  repoPath: null,
  open: (repoPath = null) => set({ isOpen: true, repoPath }),
  close: () => set({ isOpen: false, repoPath: null }),
}));
