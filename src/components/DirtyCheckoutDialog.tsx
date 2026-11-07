import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDirtyCheckoutStore } from "../store/dirtyCheckoutStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useRepoSettings } from "../hooks/useRepoSettings";
import {
  stashAndCheckout,
  discardAndCheckout,
  createWorktreeFor,
  defaultWorktreePath,
  errorMessage,
} from "../lib/dirtyCheckout";

export default function DirtyCheckoutDialog() {
  const target = useDirtyCheckoutStore((s) => s.target);
  const close = useDirtyCheckoutStore((s) => s.close);
  const repoPath = useWorkspaceStore((s) => s.repos.find((r) => r.id === s.activeRepoId)?.path ?? "");
  const { worktreeDir } = useRepoSettings(repoPath || null);
  const [worktreePath, setWorktreePath] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the user edits the worktree path, late-arriving settings must not overwrite it.
  const pathEdited = useRef(false);

  useEffect(() => {
    if (!target) return;
    pathEdited.current = false;
    setConfirmDiscard(false);
    setBusy(false);
    setError(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [target, close]);

  // Default path follows the repo and its worktree folder until the user types their own.
  useEffect(() => {
    if (!target || pathEdited.current) return;
    setWorktreePath(defaultWorktreePath(repoPath, target.name, target.isRemote, worktreeDir));
  }, [target, repoPath, worktreeDir]);

  if (!target) return null;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      close();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const secondary = "px-3 py-1.5 text-xs rounded border border-border-subtle hover:bg-hover disabled:opacity-50 text-left";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6 animate-fade-in" onClick={close}>
      <div
        role="dialog"
        aria-label="Uncommitted changes"
        className="w-full max-w-md rounded-lg border border-border-subtle bg-elevated p-4 shadow-xl text-sm text-text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-medium mb-2">
          Can't check out {target.name}
        </div>
        <div className="text-xs text-danger border border-danger rounded px-2 py-1 mb-3 break-words">{target.reason}</div>
        <div className="flex flex-col gap-2">
          <button type="button" disabled={busy} className={secondary} onClick={() => void run(() => stashAndCheckout(target))}>
            Stash and switch
          </button>
          <button
            type="button"
            disabled={busy}
            className={`${secondary} ${confirmDiscard ? "border-danger text-danger" : ""}`}
            onClick={() => {
              if (!confirmDiscard) return setConfirmDiscard(true);
              void run(() => discardAndCheckout(target));
            }}
          >
            {confirmDiscard ? "Click again to discard" : "Discard changes and switch"}
          </button>
          {target.kind === "branch" && (
            <div className="flex flex-col gap-1">
              <input
                aria-label="Worktree path"
                value={worktreePath}
                onChange={(e) => {
                  pathEdited.current = true;
                  setWorktreePath(e.target.value);
                }}
                className="w-full bg-surface border border-border-subtle rounded px-2 py-1 font-mono text-xs text-text-primary outline-none"
              />
              <button
                type="button"
                disabled={busy || !worktreePath.trim()}
                className={secondary}
                onClick={() => void run(() => createWorktreeFor(target, worktreePath.trim()))}
              >
                Open in new worktree
              </button>
            </div>
          )}
        </div>
        {error && <div className="text-xs text-danger mt-2 break-words">{error}</div>}
        <div className="flex justify-end mt-3">
          <button type="button" className="px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
