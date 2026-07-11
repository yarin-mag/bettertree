import { useState } from "react";
import { RefreshCw, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { invokeFetchRemote, invokePullRemote, invokePushRemote } from "../lib/tauri";
import ThemeToggle from "./ThemeToggle";

export default function Toolbar() {
  const { activeRepoId, repos, setActiveRepo } = useWorkspaceStore();
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const run = async (action: (path: string) => Promise<unknown>, refreshAfter: boolean) => {
    if (!activeRepo) return;
    setError(null);
    try {
      await action(activeRepo.path);
      if (refreshAfter) await setActiveRepo(activeRepo.id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-surface border-b border-border-subtle">
      <button
        className="flex items-center gap-1 text-xs px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary disabled:opacity-50"
        onClick={() => run(invokeFetchRemote, true)}
        disabled={!activeRepo}
      >
        <RefreshCw size={12} /> Fetch
      </button>
      <button
        className="flex items-center gap-1 text-xs px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50"
        onClick={() => run(invokePullRemote, true)}
        disabled={!activeRepo}
      >
        <ArrowDownToLine size={12} /> Pull
      </button>
      {/* <button
        className="flex items-center gap-1 text-xs px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary disabled:opacity-50"
        onClick={() => run(invokePushRemote, false)}
        disabled={!activeRepo}
      >
        <ArrowUpFromLine size={12} /> Push
      </button> */}
      {error && <span className="text-xs text-danger truncate">{error}</span>}
      <div className="flex-1" />
      <ThemeToggle />
    </div>
  );
}
