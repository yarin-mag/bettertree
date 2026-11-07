import { useEffect, useRef, useSyncExternalStore } from "react";
import { create } from "zustand";
import { useUiStore } from "../store/uiStore";
import { useSearchStore } from "../store/searchStore";
import { useViewStore } from "../store/viewStore";

export interface Shortcut {
  id: string;
  /** `KeyboardEvent.key` values that trigger it. */
  keys: string[];
  /** Human-readable key label for the help dialog, e.g. "j / ↓". */
  display: string;
  description: string;
  group: string;
}

// Central registry: a shortcut appears in the help dialog only while the
// component that binds it is mounted, so the list reflects what is live.
const registry = new Map<string, Shortcut>();
const listeners = new Set<() => void>();
let snapshot: Shortcut[] = [];

function publish() {
  snapshot = Array.from(registry.values());
  listeners.forEach((l) => l());
}

export function registerShortcut(shortcut: Shortcut): () => void {
  registry.set(shortcut.id, shortcut);
  publish();
  return () => {
    if (registry.get(shortcut.id) === shortcut) {
      registry.delete(shortcut.id);
      publish();
    }
  };
}

export function useRegisteredShortcuts(): Shortcut[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot
  );
}

// Shortcuts handled by components that predate the registry; listed here so
// the dialog still documents them.
export const DOCUMENTED_SHORTCUTS: Shortcut[] = [
  { id: "diff.next-hunk", keys: ["n"], display: "n", description: "Next diff hunk", group: "Diff" },
  { id: "diff.prev-hunk", keys: ["p"], display: "p", description: "Previous diff hunk", group: "Diff" },
  { id: "zoom.in", keys: [], display: "Cmd/Ctrl +", description: "Zoom in", group: "General" },
  { id: "zoom.out", keys: [], display: "Cmd/Ctrl -", description: "Zoom out", group: "General" },
  { id: "palette", keys: [], display: "Cmd/Ctrl K", description: "Open command palette", group: "General" },
];

export function isTypingTarget(el: Element | null = document.activeElement): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
  );
}

/**
 * Binds a plain-key shortcut on window. Ignored while typing in a field or
 * when a modifier is held. `enabled: false` unbinds (and unlists) it.
 */
export function useShortcut(shortcut: Shortcut, handler: (e: KeyboardEvent) => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const { id, display, description, group } = shortcut;
  const keysKey = shortcut.keys.join("\u0000");

  useEffect(() => {
    if (!enabled) return;
    const keys = keysKey.split("\u0000");
    const unregister = registerShortcut({ id, keys, display, description, group });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !keys.includes(e.key)) return;
      if (isTypingTarget()) return;
      handlerRef.current(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unregister();
    };
  }, [id, keysKey, display, description, group, enabled]);
}

interface ShortcutsDialogState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useShortcutsDialogStore = create<ShortcutsDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export const SEARCH_INPUT_PLACEHOLDER = "Search branches, tags, commits...";

/** Mounted once in App: app-wide shortcuts ('/', '?', Esc). */
export function useGlobalShortcuts() {
  const dialogOpen = useShortcutsDialogStore((s) => s.open);
  const setDialogOpen = useShortcutsDialogStore((s) => s.setOpen);

  useShortcut(
    { id: "search.focus", keys: ["/"], display: "/", description: "Focus search", group: "General" },
    (e) => {
      // SearchBar has no stable hook, so find its input by placeholder.
      const input = document.querySelector<HTMLInputElement>(`input[placeholder="${SEARCH_INPUT_PLACEHOLDER}"]`);
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    }
  );
  useShortcut(
    { id: "shortcuts.open", keys: ["?"], display: "?", description: "Show keyboard shortcuts", group: "General" },
    () => setDialogOpen(!dialogOpen)
  );
  useShortcut(
    { id: "drawer.close", keys: ["Escape"], display: "Esc", description: "Close commit drawer", group: "General" },
    () => {
      // Dialogs and menus handle Esc themselves (capture phase) before this runs.
      if (useShortcutsDialogStore.getState().open || document.querySelector("[role='dialog']")) return;
      if (useViewStore.getState().activeView !== "repo" || useSearchStore.getState().isSearchActive) return;
      if (useUiStore.getState().selectedCommitOid) useUiStore.getState().selectCommit(null);
    }
  );
}
