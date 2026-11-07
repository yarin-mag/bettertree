import { create } from "zustand";

// A pending request for the commit graph to highlight and scroll to a commit.
// The graph consumes (clears) it once the commit is in its visible list.
interface GraphFocusState {
  requestedOid: string | null;
  nonce: number;
  focusCommit: (oid: string) => void;
  clear: () => void;
}

export const useGraphFocusStore = create<GraphFocusState>((set, get) => ({
  requestedOid: null,
  nonce: 0,
  focusCommit: (oid) => set({ requestedOid: oid, nonce: get().nonce + 1 }),
  clear: () => set({ requestedOid: null }),
}));
