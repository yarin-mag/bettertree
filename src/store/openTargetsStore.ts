import { create } from "zustand";
import { invokeListOpenTargets, type OpenTarget } from "../lib/tauri";

interface OpenTargetsState {
  /** Apps the repo can be opened in, by repo path; absent until first detected. */
  byPath: Record<string, OpenTarget[]>;
  load: (path: string) => Promise<void>;
}

export const useOpenTargetsStore = create<OpenTargetsState>((set, get) => ({
  byPath: {},
  load: async (path) => {
    if (get().byPath[path]) return;
    let targets: OpenTarget[] = [];
    try {
      targets = await invokeListOpenTargets(path);
    } catch {
      // detection failed: the menu still offers Copy path
    }
    set((s) => ({ byPath: { ...s.byPath, [path]: targets } }));
  },
}));
