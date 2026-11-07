import { create } from "zustand";

export type PrOpenPreference = "ask" | "app" | "browser";

const STORAGE_KEY = "prOpenPreference";

function initialPreference(): PrOpenPreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "app" || value === "browser" ? value : "ask";
  } catch {
    return "ask";
  }
}

interface PrOpenPreferenceState {
  preference: PrOpenPreference;
  setPreference: (preference: PrOpenPreference) => void;
}

export const usePrOpenPreferenceStore = create<PrOpenPreferenceState>((set) => ({
  preference: initialPreference(),
  setPreference: (preference) => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // storage unavailable: the choice still applies for this session
    }
    set({ preference });
  },
}));
