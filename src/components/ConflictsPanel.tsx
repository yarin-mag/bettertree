import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, RefreshCw, FileWarning, ExternalLink, Copy, CheckCheck, Ban } from "lucide-react";
import { useConflictStore } from "../store/conflictStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { invokeAbortMerge, invokeMarkResolved, invokeOpenInEditor } from "../lib/tauri";
import { toast } from "../store/toastStore";

const HEADER_BUTTON =
  "flex items-center gap-1 text-xs px-2 py-1 rounded border border-border-subtle bg-elevated text-text-primary hover:bg-hover disabled:opacity-50 press-scale";

export default function ConflictsPanel({ repoPath }: { repoPath: string }) {
  const { files, inProgress, operation, refresh, closePanel } = useConflictStore();
  const [confirmingAbort, setConfirmingAbort] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closePanel]);

  const handleRefresh = async () => {
    setBusy(true);
    await refresh(repoPath);
    setBusy(false);
  };

  const handleOpen = async (file: string) => {
    try {
      await invokeOpenInEditor(repoPath, file);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleCopy = async (file: string) => {
    try {
      await navigator.clipboard.writeText(file);
      toast.success("Path copied");
    } catch {
      toast.error("Could not copy path");
    }
  };

  const handleResolve = async (file: string) => {
    try {
      await invokeMarkResolved(repoPath, file);
      await refresh(repoPath);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleAbort = async () => {
    setConfirmingAbort(false);
    try {
      await invokeAbortMerge(repoPath);
      toast.success(`${operation === "rebase" ? "Rebase" : "Merge"} aborted`);
      await refresh(repoPath);
      const { activeRepoId, setActiveRepo } = useWorkspaceStore.getState();
      if (activeRepoId !== null) await setActiveRepo(activeRepoId);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6 animate-fade-in"
      onClick={closePanel}
    >
      <div
        role="dialog"
        aria-label="Merge conflicts"
        className="w-full max-w-lg max-h-[80vh] bg-surface border border-border-subtle rounded-lg shadow-2xl p-4 flex flex-col gap-3 animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-text-primary">
            Merge conflicts{files.length > 0 ? ` (${files.length})` : ""}
          </div>
          <button
            className="text-text-muted hover:text-text-primary press-scale"
            onClick={closePanel}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button className={HEADER_BUTTON} onClick={handleRefresh} disabled={busy}>
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
          <div className="flex-1" />
          {inProgress && !confirmingAbort && (
            <button className={`${HEADER_BUTTON} text-danger`} onClick={() => setConfirmingAbort(true)}>
              <Ban size={12} /> Abort merge
            </button>
          )}
          {confirmingAbort && (
            <div className="flex items-center gap-1.5 text-xs text-text-primary">
              <span>Discard all merge progress?</span>
              <button className={`${HEADER_BUTTON} text-danger`} onClick={handleAbort}>
                Yes, abort
              </button>
              <button className={HEADER_BUTTON} onClick={() => setConfirmingAbort(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {files.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-6 text-center">
            <CheckCheck size={20} className="text-success" />
            <div className="text-sm text-text-primary">All conflicts resolved</div>
            <div className="text-xs text-text-muted">
              {inProgress
                ? "Continue by committing the merge to finish."
                : "There is no merge in progress."}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 overflow-y-auto">
            {files.map((f) => (
              <div
                key={f.path}
                className="flex flex-col gap-2 rounded border border-border-subtle p-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileWarning size={12} className="text-danger shrink-0" />
                  <span className="text-xs font-mono text-text-primary truncate" title={f.path}>
                    {f.path}
                  </span>
                  <span className="text-xs text-text-muted shrink-0">{f.status}</span>
                </div>
                <div className="flex gap-2">
                  <button className={HEADER_BUTTON} onClick={() => handleOpen(f.path)}>
                    <ExternalLink size={12} /> Open in editor
                  </button>
                  <button className={HEADER_BUTTON} onClick={() => handleCopy(f.path)}>
                    <Copy size={12} /> Copy path
                  </button>
                  <button className={HEADER_BUTTON} onClick={() => handleResolve(f.path)}>
                    <CheckCheck size={12} /> Mark resolved
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
