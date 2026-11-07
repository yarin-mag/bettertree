import { create } from "zustand";

export type ActiveView = "repo" | "pulls" | "compare" | "actions";

interface ViewState {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: "repo",
  setActiveView: (activeView: ActiveView) => set({ activeView }),
}));
