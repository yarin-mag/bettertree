import { create } from "zustand";

// Diff view display prefs. Kept in a store (rather than DiffViewer's own
// local state) so they survive DiffViewer unmounting between file
// selections, e.g. in WorkingCopyPanel where the whole viewer unmounts
// when no file is selected.
interface DiffViewState {
  mode: "unified" | "split";
  ignoreWhitespace: boolean;
  /** Wrap long lines instead of scrolling sideways. Remembered across launches. */
  wrapLines: boolean;
  setMode: (mode: "unified" | "split") => void;
  setIgnoreWhitespace: (ignoreWhitespace: boolean) => void;
  setWrapLines: (wrapLines: boolean) => void;
}

const WRAP_KEY = "bettertree.diff.wrapLines";

function readWrapPreference(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeWrapPreference(value: boolean): void {
  try {
    localStorage.setItem(WRAP_KEY, String(value));
  } catch {
    // storage blocked: the preference just won't survive a restart
  }
}

export const useDiffViewStore = create<DiffViewState>((set) => ({
  mode: "unified",
  ignoreWhitespace: false,
  wrapLines: readWrapPreference(),
  setMode: (mode) => set({ mode }),
  setIgnoreWhitespace: (ignoreWhitespace) => set({ ignoreWhitespace }),
  setWrapLines: (wrapLines) => {
    writeWrapPreference(wrapLines);
    set({ wrapLines });
  },
}));
