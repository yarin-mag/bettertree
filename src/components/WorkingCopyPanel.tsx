import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus } from "lucide-react";
import { toast } from "../store/toastStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkingCopyStore } from "../store/workingCopyStore";
import { invokeGetWorkingDiff, type FileDiff } from "../lib/tauri";
import DiffViewer from "./DiffViewer";
import { SkeletonBlock } from "./Skeleton";
import EmptyState from "./EmptyState";

// Nothing watches the working tree for changes, so the status list and the
// open diff can go stale while this panel sits open. Poll at a modest
// cadence to bound that staleness without hammering the git backend.
const POLL_INTERVAL_MS = 5000;

export default function WorkingCopyPanel() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { status, commitMessage, setCommitMessage, refreshStatus, stage, unstage, commit } =
    useWorkingCopyStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);
  const requestRef = useRef<string | null>(null);
  const lastPatchRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const commitInputFocusedRef = useRef(false);
  const selectedEntry = status.find((e) => e.path === selectedPath) ?? null;

  useEffect(() => {
    if (activeRepo) refreshStatus(activeRepo.path);
  }, [activeRepo?.path, refreshStatus]);

  // A selected file can disappear from status entirely (fully reverted,
  // staged+committed elsewhere) between polls; without this the diff panel
  // is left showing a stale/dead diff with no way to tell it's gone.
  useEffect(() => {
    if (selectedPath && !status.some((e) => e.path === selectedPath)) {
      setSelectedPath(null);
    }
  }, [status, selectedPath]);

  // Background refresh: catches file-status changes (edits, new/removed
  // files) made outside this panel while it's open. Skipped while a
  // stage/unstage/commit is in flight or the commit-message input has
  // focus, so a poll can't land mid-action or yank focus away while typing.
  useEffect(() => {
    if (!activeRepo) return;
    const repoPath = activeRepo.path;
    const interval = setInterval(() => {
      if (busyRef.current || commitInputFocusedRef.current) return;
      refreshStatus(repoPath).catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeRepo?.path, refreshStatus]);

  useEffect(() => {
    requestRef.current = selectedPath;
    if (!activeRepo || !selectedPath || !selectedEntry) {
      setDiff(null);
      setDiffError(null);
      lastPatchRef.current = null;
      return;
    }
    const staged = selectedEntry.state === "ModifiedStaged";
    setDiffError(null);
    invokeGetWorkingDiff(activeRepo.path, selectedPath, staged)
      .then((result) => {
        if (requestRef.current !== selectedPath) return;
        lastPatchRef.current = result.patch;
        setDiff(result);
      })
      .catch((e) => {
        if (requestRef.current !== selectedPath) return;
        setDiff(null);
        setDiffError(String(e));
      });
  }, [activeRepo?.path, selectedPath, selectedEntry?.state]);

  // Background refresh for the open diff itself: the file's status entry
  // (e.g. "Modified") doesn't change when it's edited further, so the effect
  // above alone won't catch a still-changing file. Only swap the diff state
  // when the patch actually differs, so an unchanged poll doesn't force
  // DiffViewer to re-run syntax highlighting or lose scroll/collapse state,
  // and briefly flash when it does change so a silent background update
  // doesn't go unnoticed.
  useEffect(() => {
    if (!activeRepo || !selectedPath || !selectedEntry) return;
    const repoPath = activeRepo.path;
    const staged = selectedEntry.state === "ModifiedStaged";
    const interval = setInterval(() => {
      if (busyRef.current || commitInputFocusedRef.current) return;
      invokeGetWorkingDiff(repoPath, selectedPath, staged)
        .then((result) => {
          if (requestRef.current !== selectedPath) return;
          if (lastPatchRef.current === result.patch) return;
          lastPatchRef.current = result.patch;
          setDiff(result);
          setJustUpdated(true);
          setTimeout(() => setJustUpdated(false), 700);
        })
        .catch(() => {
          // Stay on the last good diff; a transient poll failure shouldn't
          // blow away what's already showing.
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeRepo?.path, selectedPath, selectedEntry?.state]);

  const files = useMemo(() => (diff ? [diff] : []), [diff]);

  if (!activeRepo) return null;

  const withBusy = async (action: () => Promise<void>) => {
    busyRef.current = true;
    try {
      await action();
    } finally {
      busyRef.current = false;
    }
  };

  const handleCommit = async () => {
    await withBusy(async () => {
      try {
        await commit(activeRepo.path);
        setSelectedPath(null);
        toast.success("Changes committed");
      } catch (e) {
        toast.error(`Commit failed: ${e}`);
      }
    });
  };

  return (
    <div className="p-2 border-t border-border-subtle text-sm">
      <div className="text-xs uppercase text-text-muted mb-1">Changes</div>
      <div className="flex flex-col gap-1 mb-2 max-h-40 overflow-y-auto">
        {status.map((entry) => (
          <div
            key={entry.path}
            onClick={() => setSelectedPath(entry.path)}
            className={`flex items-center justify-between gap-1 px-1 py-0.5 rounded cursor-pointer transition-colors duration-100 ${
              entry.path === selectedPath ? "bg-accent-soft text-accent" : "hover:bg-hover"
            }`}
          >
            <span className="truncate flex-1 font-mono text-xs text-text-primary">{entry.path}</span>
            <span className="text-text-muted text-xs">{entry.state}</span>
            {entry.state === "ModifiedStaged" ? (
              <button
                className="flex items-center gap-1 text-xs px-2 py-0.5 bg-elevated border border-border-subtle rounded text-text-primary hover:bg-hover press-scale"
                onClick={(e) => {
                  e.stopPropagation();
                  withBusy(() =>
                    unstage(activeRepo.path, entry.path).catch((err) => {
                      toast.error(`Couldn't unstage ${entry.path}: ${err}`);
                    }),
                  );
                }}
              >
                <Minus size={11} /> Unstage
              </button>
            ) : (
              <button
                className="flex items-center gap-1 text-xs px-2 py-0.5 bg-elevated border border-border-subtle rounded text-text-primary hover:bg-hover press-scale"
                onClick={(e) => {
                  e.stopPropagation();
                  withBusy(() =>
                    stage(activeRepo.path, entry.path).catch((err) => {
                      toast.error(`Couldn't stage ${entry.path}: ${err}`);
                    }),
                  );
                }}
              >
                <Plus size={11} /> Stage
              </button>
            )}
          </div>
        ))}
      </div>
      {selectedPath && (
        <div
          className={`mb-2 max-h-64 overflow-y-auto border rounded p-1 transition-colors duration-700 ${
            justUpdated ? "border-accent bg-accent-soft/30" : "border-border-subtle"
          }`}
        >
          {diffError ? (
            <EmptyState compact variant="error" title="Failed to load diff" details={diffError} />
          ) : diff ? (
            <DiffViewer files={files} />
          ) : (
            <div className="p-1">
              <SkeletonBlock lines={4} />
            </div>
          )}
        </div>
      )}
      <input
        className="w-full px-2 py-1 bg-elevated border border-border-subtle rounded mb-1 text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Commit message"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        onFocus={() => {
          commitInputFocusedRef.current = true;
        }}
        onBlur={() => {
          commitInputFocusedRef.current = false;
        }}
      />
      <button
        className="w-full px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50 hover:brightness-110 press-scale"
        onClick={handleCommit}
        disabled={commitMessage.trim().length === 0}
      >
        Commit
      </button>
    </div>
  );
}
