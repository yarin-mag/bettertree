import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBranchActionStore } from "../store/branchActionStore";
import { createBranchAt } from "../lib/branchActions";

export default function CreateBranchDialog() {
  const target = useBranchActionStore((s) => s.createBranchTarget);
  const close = useBranchActionStore((s) => s.closeCreateBranch);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!target) return;
    setName("");
    setError(null);
    setBusy(false);
    inputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [target, close]);

  if (!target) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createBranchAt(trimmed, target.oid);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6 animate-fade-in" onClick={close}>
      <form
        role="dialog"
        aria-label="Create branch"
        className="w-full max-w-sm rounded-lg border border-border-subtle bg-elevated p-4 shadow-xl text-sm text-text-primary"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="font-medium mb-1">Create branch</div>
        <div className="text-xs text-text-muted mb-2 truncate">at {target.label}</div>
        <input
          ref={inputRef}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="new-branch-name"
          aria-label="Branch name"
          className="w-full bg-surface border border-border-subtle rounded px-2 py-1 text-sm text-text-primary outline-none"
        />
        {error && <div className="text-xs text-danger mt-1 break-words">{error}</div>}
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" className="px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="px-3 py-1 text-xs rounded bg-accent text-accent-contrast disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
