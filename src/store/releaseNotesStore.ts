import { create } from "zustand";

export interface ReleaseNotesEnd {
  oid: string;
  label: string;
  /** Only set for graph rows; lets two marks given in the wrong order be swapped. */
  timestamp?: number;
}

// The two commits that bound a release-notes range. With exactly one set the
// graph is in pick mode, waiting for the other; with both set the dialog opens.
interface ReleaseNotesState {
  from: ReleaseNotesEnd | null;
  to: ReleaseNotesEnd | null;
  markFrom: (end: ReleaseNotesEnd) => void;
  markTo: (end: ReleaseNotesEnd) => void;
  /** Fills whichever end is still empty (pick mode). */
  pick: (end: ReleaseNotesEnd) => void;
  startRange: (from: ReleaseNotesEnd, to: ReleaseNotesEnd) => void;
  swap: () => void;
  clear: () => void;
}

// Marks may come in either order; keep the older commit as `from`.
function ordered(from: ReleaseNotesEnd | null, to: ReleaseNotesEnd | null) {
  if (from && to && from.timestamp !== undefined && to.timestamp !== undefined && from.timestamp > to.timestamp) {
    return { from: to, to: from };
  }
  return { from, to };
}

export const useReleaseNotesStore = create<ReleaseNotesState>((set, get) => ({
  from: null,
  to: null,
  markFrom: (end) => set(ordered(end, get().to)),
  markTo: (end) => set(ordered(get().from, end)),
  pick: (end) => (get().from ? get().markTo(end) : get().markFrom(end)),
  startRange: (from, to) => set({ from, to }),
  swap: () => set({ from: get().to, to: get().from }),
  clear: () => set({ from: null, to: null }),
}));

/** True while exactly one end is marked. */
export const selectPicking = (s: ReleaseNotesState) => (s.from === null) !== (s.to === null);
