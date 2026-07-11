import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Minus } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkingCopyStore } from "../store/workingCopyStore";
import { invokeGetWorkingDiff, type FileDiff } from "../lib/tauri";
import DiffViewer from "./DiffViewer";

export default function WorkingCopyPanel() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { status, commitMessage, setCommitMessage, refreshStatus, stage, unstage, commit } =
    useWorkingCopyStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const requestRef = useRef<string | null>(null);
  const selectedEntry = status.find((e) => e.path === selectedPath) ?? null;

  useEffect(() => {
    if (activeRepo) refreshStatus(activeRepo.path);
  }, [activeRepo?.path, refreshStatus]);

  useEffect(() => {
    requestRef.current = selectedPath;
    if (!activeRepo || !selectedPath || !selectedEntry) {
      setDiff(null);
      setDiffError(null);
      return;
    }
    const staged = selectedEntry.state === "ModifiedStaged";
    setDiffError(null);
    invokeGetWorkingDiff(activeRepo.path, selectedPath, staged)
      .then((result) => {
        if (requestRef.current !== selectedPath) return;
        setDiff(result);
      })
      .catch((e) => {
        if (requestRef.current !== selectedPath) return;
        setDiff(null);
        setDiffError(String(e));
      });
  }, [activeRepo?.path, selectedPath, selectedEntry?.state]);

  if (!activeRepo) return null;

  const handleCommit = async () => {
    await commit(activeRepo.path);
    setSelectedPath(null);
  };

  return (
    <div className="p-2 border-t border-border-subtle text-sm">
      <div className="text-xs uppercase text-text-muted mb-1">Changes</div>
      <div className="flex flex-col gap-1 mb-2 max-h-40 overflow-y-auto">
        {status.map((entry) => (
          <div
            key={entry.path}
            onClick={() => setSelectedPath(entry.path)}
            className={`flex items-center justify-between gap-1 px-1 py-0.5 rounded cursor-pointer ${
              entry.path === selectedPath ? "bg-accent-soft text-accent" : "hover:bg-hover"
            }`}
          >
            <span className="truncate flex-1 font-mono text-xs text-text-primary">{entry.path}</span>
            <span className="text-text-muted text-xs">{entry.state}</span>
            {entry.state === "ModifiedStaged" ? (
              <button
                className="flex items-center gap-1 text-xs px-2 py-0.5 bg-elevated border border-border-subtle rounded text-text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  unstage(activeRepo.path, entry.path);
                }}
              >
                <Minus size={11} /> Unstage
              </button>
            ) : (
              <button
                className="flex items-center gap-1 text-xs px-2 py-0.5 bg-elevated border border-border-subtle rounded text-text-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  stage(activeRepo.path, entry.path);
                }}
              >
                <Plus size={11} /> Stage
              </button>
            )}
          </div>
        ))}
      </div>
      {selectedPath && (
        <div className="mb-2 max-h-64 overflow-y-auto border border-border-subtle rounded p-1">
          {diffError ? (
            <div className="text-xs text-danger p-1">Failed to load diff: {diffError}</div>
          ) : diff ? (
            <DiffViewer files={[diff]} />
          ) : (
            <div className="flex items-center gap-2 text-xs text-text-muted p-1">
              <Loader2 size={12} className="animate-spin" />
              Loading diff...
            </div>
          )}
        </div>
      )}
      <input
        className="w-full px-2 py-1 bg-elevated border border-border-subtle rounded mb-1 text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Commit message"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
      />
      <button
        className="w-full px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50"
        onClick={handleCommit}
        disabled={commitMessage.trim().length === 0}
      >
        Commit
      </button>
    </div>
  );
}
