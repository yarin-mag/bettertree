import { create } from "zustand";
import {
  invokeAddReleaseNote,
  invokeListReleaseNotes,
  invokeDeleteReleaseNote,
  type ReleaseNoteEntry,
} from "../lib/tauri";

interface HistoryState {
  /** Newest first, per repo path. */
  byRepo: Record<string, ReleaseNoteEntry[]>;
  /** Always reads from the backend; throws on failure so the list can show it. */
  load: (path: string) => Promise<void>;
  /** Saves one entry; a de-duplicated entry replaces its older copy in the list. */
  add: (path: string, fromLabel: string, toLabel: string, text: string) => Promise<void>;
  remove: (path: string, id: number) => Promise<void>;
}

export const useReleaseNotesHistoryStore = create<HistoryState>((set) => ({
  byRepo: {},
  load: async (path) => {
    const list = await invokeListReleaseNotes(path);
    set((s) => ({ byRepo: { ...s.byRepo, [path]: list } }));
  },
  add: async (path, fromLabel, toLabel, text) => {
    const entry = await invokeAddReleaseNote(path, fromLabel, toLabel, text);
    set((s) => {
      const rest = (s.byRepo[path] ?? []).filter((e) => e.id !== entry.id);
      return { byRepo: { ...s.byRepo, [path]: [entry, ...rest] } };
    });
  },
  remove: async (path, id) => {
    await invokeDeleteReleaseNote(id);
    set((s) => ({ byRepo: { ...s.byRepo, [path]: (s.byRepo[path] ?? []).filter((e) => e.id !== id) } }));
  },
}));
