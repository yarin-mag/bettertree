import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  DOCUMENTED_SHORTCUTS,
  useRegisteredShortcuts,
  useShortcutsDialogStore,
  type Shortcut,
} from "../hooks/useKeyboardShortcuts";

export default function ShortcutsDialog() {
  const open = useShortcutsDialogStore((s) => s.open);
  const setOpen = useShortcutsDialogStore((s) => s.setOpen);
  const registered = useRegisteredShortcuts();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, setOpen]);

  if (!open) return null;

  const byId = new Map<string, Shortcut>();
  for (const s of [...DOCUMENTED_SHORTCUTS, ...registered]) byId.set(s.id, s);
  const groups = new Map<string, Shortcut[]>();
  for (const s of byId.values()) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6 animate-fade-in" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-lg border border-border-subtle bg-elevated p-4 shadow-xl text-sm text-text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-medium mb-2">Keyboard shortcuts</div>
        {Array.from(groups.entries()).map(([group, items]) => (
          <div key={group} className="mb-3">
            <div className="text-xs uppercase text-text-muted mb-1">{group}</div>
            {items.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-0.5">
                <span>{s.description}</span>
                <kbd className="ml-3 shrink-0 px-1.5 rounded border border-border-subtle bg-surface font-mono text-xs text-text-muted">
                  {s.display}
                </kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}
