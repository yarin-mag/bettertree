import { create } from "zustand";
import type { Size } from "../lib/modalLayout";

// Size and full-screen state of the commit modal, remembered across launches.
// `size: null` means "use the default for the current window".
interface ModalLayoutState {
  size: Size | null;
  fullscreen: boolean;
  setSize: (size: Size) => void;
  resetSize: () => void;
  toggleFullscreen: () => void;
}

const KEY = "bettertree.commitModal.layout";

function read(): { size: Size | null; fullscreen: boolean } {
  const fallback = { size: null, fullscreen: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { size?: { w?: unknown; h?: unknown } | null; fullscreen?: unknown };
    const size =
      parsed.size && Number.isFinite(parsed.size.w) && Number.isFinite(parsed.size.h)
        ? { w: parsed.size.w as number, h: parsed.size.h as number }
        : null;
    return { size, fullscreen: parsed.fullscreen === true };
  } catch {
    return fallback;
  }
}

function write(state: { size: Size | null; fullscreen: boolean }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ size: state.size, fullscreen: state.fullscreen }));
  } catch {
    // storage blocked: the layout just won't survive a restart
  }
}

export const useModalLayoutStore = create<ModalLayoutState>((set, get) => ({
  ...read(),
  setSize: (size) => {
    set({ size });
    write(get());
  },
  resetSize: () => {
    set({ size: null });
    write(get());
  },
  toggleFullscreen: () => {
    set({ fullscreen: !get().fullscreen });
    write(get());
  },
}));
