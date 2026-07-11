import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { invokeGetCommitDiff, type CommitDetail } from "../lib/tauri";
import DiffViewer from "./DiffViewer";
import ResizeHandle from "./ResizeHandle";
import { useResizable } from "../hooks/useResizable";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 640;

export default function CommitDrawer() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { selectedCommitOid, selectCommit, setLoadingCommit } = useUiStore();
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const { size, onMouseDown } = useResizable(320, MIN_HEIGHT, MAX_HEIGHT, "y", true);
  const requestOidRef = useRef<string | null>(null);

  useEffect(() => {
    requestOidRef.current = selectedCommitOid;
    if (!activeRepo || !selectedCommitOid) {
      setDetail(null);
      setError(null);
      setLoadingCommit(false);
      return;
    }
    setError(null);
    setLoadingCommit(true);
    invokeGetCommitDiff(activeRepo.path, selectedCommitOid)
      .then((result) => {
        if (requestOidRef.current !== selectedCommitOid) return;
        setDetail(result);
      })
      .catch((e) => {
        if (requestOidRef.current !== selectedCommitOid) return;
        setDetail(null);
        setError(String(e));
      })
      .finally(() => {
        if (requestOidRef.current !== selectedCommitOid) return;
        setLoadingCommit(false);
      });
  }, [activeRepo?.path, selectedCommitOid, setLoadingCommit]);

  if (!selectedCommitOid) return null;

  if (error) {
    return (
      <div className="border-t border-border-subtle bg-surface p-3 text-sm text-danger">
        Failed to load commit: {error}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="border-t border-border-subtle bg-surface p-3 flex items-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin" />
        Loading commit...
      </div>
    );
  }

  const date = new Date(detail.timestamp * 1000).toLocaleString();

  return (
    <div
      className="relative border-t border-border-subtle bg-surface overflow-y-auto p-3 flex-shrink-0"
      style={{ height: size }}
    >
      <ResizeHandle axis="y" edge="start" onMouseDown={onMouseDown} />
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-medium text-text-primary">{detail.message}</div>
          <div className="text-xs text-text-muted font-mono">
            {detail.author} &lt;{detail.email}&gt; — {date}
          </div>
        </div>
        <button
          className="text-text-muted hover:text-text-primary"
          onClick={() => selectCommit(null)}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
      <DiffViewer files={detail.files} />
    </div>
  );
}
