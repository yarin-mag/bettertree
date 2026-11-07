import { useEffect, useState } from "react";
import { AlertTriangle, Check, RefreshCw, ArrowDownToLine, GitMerge, ExternalLink } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useViewStore } from "../store/viewStore";
import { useGithubStore } from "../store/githubStore";
import { invokePullRemote } from "../lib/tauri";
import { useConflictStore, isConflictError } from "../store/conflictStore";
import { toast } from "../store/toastStore";
import ConflictsPanel from "./ConflictsPanel";
import { useAutoFetch } from "../hooks/useAutoFetch";
import { useRepoSync } from "../hooks/useRepoSync";
import { timeAgo } from "../lib/timeAgo";
import { useAheadBehind } from "../hooks/useAheadBehind";
import BranchSwitcher from "./BranchSwitcher";
import { useContextMenu } from "./ContextMenu";
import { useOpenTargetsStore } from "../store/openTargetsStore";
import { buildOpenInItems } from "../lib/openIn";

const CLOCK_TICK_MS = 10_000;
// Conflict list is only polled while a merge/rebase is in progress (files can
// be resolved outside the app), and then only occasionally.
const CONFLICT_POLL_MS = 5_000;

export default function Toolbar() {
  const { activeRepoId, repos, setActiveRepo, branches, tags, headDetached, headOid } = useWorkspaceStore();
  const { activeView } = useViewStore();
  const { pullRequests } = useGithubStore();
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const { lastFetchedAt, isFetching, justFetched, fetchError, fetchNow } = useAutoFetch(activeRepoId, activeRepo?.path);
  useRepoSync(activeRepo?.path);
  const { openMenu, menu: openInMenu } = useContextMenu();
  const openTargets = useOpenTargetsStore((s) => (activeRepo ? s.byPath[activeRepo.path] : undefined));
  useEffect(() => {
    if (activeRepo) void useOpenTargetsStore.getState().load(activeRepo.path);
  }, [activeRepo?.path]);
  const [now, setNow] = useState(() => Date.now());
  const { files: conflictFiles, inProgress: mergeInProgress, panelOpen, refresh: refreshConflicts, reset: resetConflicts, openPanel } =
    useConflictStore();
  const repoPath = activeRepo?.path;
  const aheadBehind = useAheadBehind(repoPath);
  const currentBranch = branches.find((b) => b.isHead && !b.isRemote)?.name;
  const detachedLabel = headDetached && headOid ? `detached @ ${tags.find((t) => t.targetOid === headOid)?.name ?? headOid.slice(0, 7)}` : null;
  const chipName = activeRepo ? (headDetached ? detachedLabel : currentBranch) : null;
  const showAhead = aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0);

  useEffect(() => {
    if (!repoPath) {
      resetConflicts();
      return;
    }
    refreshConflicts(repoPath);
  }, [repoPath, refreshConflicts, resetConflicts]);

  useEffect(() => {
    if (!repoPath || !mergeInProgress) return;
    const id = setInterval(() => refreshConflicts(repoPath), CONFLICT_POLL_MS);
    return () => clearInterval(id);
  }, [repoPath, mergeInProgress, refreshConflicts]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const handleFetch = async () => {
    setError(null);
    try {
      await fetchNow(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const run = async (action: (path: string) => Promise<unknown>, refreshAfter: boolean) => {
    if (!activeRepo) return;
    setError(null);
    try {
      await action(activeRepo.path);
      if (refreshAfter) await setActiveRepo(activeRepo.id);
    } catch (e) {
      if (isConflictError(e)) {
        toast.error("Pull produced merge conflicts", { action: { label: "View conflicts", onClick: openPanel } });
        if (refreshAfter) await setActiveRepo(activeRepo.id).catch(() => {});
      } else {
        setError(String(e));
      }
    }
    await refreshConflicts(activeRepo.path);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border-b border-border-subtle">
      <span className="text-xs font-medium text-text-primary truncate">
        {activeRepo?.name ?? "No repo selected"}
      </span>
      {activeRepo && (
        <button
          type="button"
          aria-label="Open in…"
          title="Open in editor, terminal or Finder"
          className="text-text-muted hover:text-text-primary shrink-0"
          onClick={(e) => openMenu(e, buildOpenInItems(activeRepo.path, openTargets ?? []))}
        >
          <ExternalLink size={12} />
        </button>
      )}
      {openInMenu}
      {chipName && <BranchSwitcher chipName={chipName} detached={headDetached} />}
      {chipName && showAhead && (
        <span
          data-testid="ahead-behind"
          className="text-[10px] font-mono text-text-muted shrink-0 [font-variant-numeric:tabular-nums]"
          title={`${aheadBehind.ahead} ahead / ${aheadBehind.behind} behind ${aheadBehind.upstream}`}
        >
          {[aheadBehind.ahead > 0 && `↑${aheadBehind.ahead}`, aheadBehind.behind > 0 && `↓${aheadBehind.behind}`]
            .filter(Boolean)
            .join(" ")}
        </span>
      )}
      {error && <span className="text-xs text-danger truncate">{error}</span>}
      <div className="flex-1" />
      {activeView === "pulls" && (
        <span className="text-xs text-text-muted [font-variant-numeric:tabular-nums]">
          {pullRequests.length} {pullRequests.length === 1 ? "result" : "results"}
        </span>
      )}
      {(conflictFiles.length > 0 || mergeInProgress) && (
        <button
          className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-danger text-danger hover:bg-hover press-scale"
          onClick={openPanel}
        >
          <GitMerge size={12} />{" "}
          {conflictFiles.length > 0
            ? `${conflictFiles.length} ${conflictFiles.length === 1 ? "conflict" : "conflicts"}`
            : "Merge in progress"}
        </button>
      )}
      {fetchError && (
        <span
          className="flex items-center gap-1 text-xs text-danger"
          title={`${fetchError}\nAuto-fetch is retrying with backoff.`}
        >
          <AlertTriangle size={12} /> Fetch failed
        </span>
      )}
      {lastFetchedAt !== null && (
        <span
          className="text-xs text-text-muted [font-variant-numeric:tabular-nums]"
          title={new Date(lastFetchedAt).toLocaleString()}
        >
          Fetched {timeAgo(lastFetchedAt, now)}
        </span>
      )}
      <div className="flex rounded border border-border-subtle overflow-hidden">
        <button
          className={`flex items-center gap-1 text-xs px-2 py-1 text-text-primary hover:bg-hover disabled:opacity-50 press-scale transition-colors duration-300 ${
            justFetched ? "fetch-flash" : "bg-elevated"
          }`}
          onClick={handleFetch}
          disabled={!activeRepo}
        >
          {justFetched && !isFetching ? (
            <Check size={12} className="animate-pop-in text-success" />
          ) : (
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          )}{" "}
          Fetch
        </button>
        <button
          className="flex items-center gap-1 text-xs px-2 py-1 bg-accent text-accent-contrast border-l border-border-subtle disabled:opacity-50 press-scale"
          onClick={() => run(invokePullRemote, true)}
          disabled={!activeRepo}
        >
          <ArrowDownToLine size={12} /> Pull
        </button>
      </div>
      {panelOpen && repoPath && <ConflictsPanel repoPath={repoPath} />}
    </div>
  );
}
