import { create } from "zustand";
import { invokeCompareRefs, type CompareResult } from "../lib/tauri";

interface CompareState {
  baseRef: string | null;
  compareRef: string | null;
  result: CompareResult | null;
  isLoading: boolean;
  error: string | null;
  setBaseRef: (ref: string) => void;
  setCompareRef: (ref: string) => void;
  loadCompare: (repoPath: string) => Promise<void>;
}

export const useCompareStore = create<CompareState>((set, get) => ({
  baseRef: null,
  compareRef: null,
  result: null,
  isLoading: false,
  error: null,
  setBaseRef: (baseRef) => set({ baseRef }),
  setCompareRef: (compareRef) => set({ compareRef }),
  loadCompare: async (repoPath: string) => {
    const { baseRef, compareRef } = get();
    if (!baseRef || !compareRef) return;
    set({ isLoading: true, error: null });
    try {
      const result = await invokeCompareRefs(repoPath, baseRef, compareRef);
      set({ result });
    } catch (e) {
      set({ error: String(e), result: null });
    } finally {
      set({ isLoading: false });
    }
  },
}));
