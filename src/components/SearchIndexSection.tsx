import { useCallback, useEffect, useState } from "react";
import { invokeClearSearchIndex, invokeListSearchIndexUsage, type SearchIndexUsage } from "../lib/tauri";
import { formatBytes } from "../lib/formatBytes";
import { toast } from "../store/toastStore";

function repoLabel(repoPath: string | null): string {
  if (!repoPath) return "Unknown repository";
  return repoPath.split("/").filter(Boolean).pop() ?? repoPath;
}

export default function SearchIndexSection() {
  const [usage, setUsage] = useState<SearchIndexUsage[]>([]);

  const refresh = useCallback(async () => {
    try {
      setUsage(await invokeListSearchIndexUsage());
    } catch {
      setUsage([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = async (key?: string) => {
    try {
      await invokeClearSearchIndex(key);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  };

  const total = usage.reduce((sum, u) => sum + u.sizeBytes, 0);
  const buttonClass = "text-xs px-2 py-0.5 rounded border border-border-subtle hover:bg-hover text-text-primary";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs uppercase tracking-wide text-text-muted">Search index</div>
        {usage.length > 0 && (
          <button type="button" className={buttonClass} onClick={() => void clear()}>
            Clear all
          </button>
        )}
      </div>
      {usage.length === 0 ? (
        <div className="text-xs text-text-muted">No search index yet.</div>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {usage.map((u) => (
              <div key={u.key} className="flex items-center justify-between gap-2 text-xs text-text-primary">
                <span className="truncate" title={u.repoPath ?? undefined}>
                  {repoLabel(u.repoPath)}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-text-muted">{formatBytes(u.sizeBytes)}</span>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={`Clear index for ${repoLabel(u.repoPath)}`}
                    onClick={() => void clear(u.key)}
                  >
                    Clear
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div className="text-xs text-text-muted mt-1">Total {formatBytes(total)}</div>
        </>
      )}
      <div className="text-xs text-text-muted mt-1">
        Cleared indexes rebuild in the background; search falls back to commit messages meanwhile.
      </div>
    </div>
  );
}
