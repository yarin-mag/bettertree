import { useEffect, useMemo } from "react";
import { Loader2, PlayCircle, PlugZap, RefreshCw, SearchX, Star } from "lucide-react";
import { FolderGit2 } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { ACTIONS_POLL_MS, useActionsStore, type ActionsFilters } from "../store/actionsStore";
import { describeGithubUnavailable } from "../lib/githubUnavailable";
import { formatDuration, runState, workflowTitle } from "../lib/ci";
import { shortCiError } from "../lib/ciErrors";
import { timeAgo } from "../lib/timeAgo";
import type { RunSummary } from "../lib/tauri";
import EmptyState from "./EmptyState";
import { SkeletonBlock } from "./Skeleton";
import { StateIcon } from "./WorkflowCard";
import BranchCombobox from "./BranchCombobox";
import UserCombobox from "./UserCombobox";
import ActionRunDetail from "./ActionRunDetail";

const STATUS_OPTIONS: { value: ActionsFilters["status"]; label: string }[] = [
  { value: "", label: "All" },
  { value: "failure", label: "Failed" },
  { value: "in_progress", label: "Running" },
  { value: "success", label: "Success" },
];

const EVENTS = ["push", "pull_request", "schedule", "workflow_dispatch", "release"];

const SELECT = "px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary";

function RunRow({ run, title, favorite, onOpen }: { run: RunSummary; title: string; favorite: boolean; onOpen: () => void }) {
  const state = runState(run);
  const created = Date.parse(run.createdAt);
  const duration = run.status === "completed" ? formatDuration(run.startedAt ?? run.createdAt, run.updatedAt) : "";
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="run-row"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="h-9 px-3 border-b border-border-subtle flex items-center gap-2 text-xs cursor-pointer hover:bg-hover transition-colors duration-100"
    >
      <StateIcon state={state} />
      <span className="font-medium text-text-primary truncate max-w-[12rem] shrink-0">{title}</span>
      {favorite && <Star size={11} className="text-accent shrink-0" fill="currentColor" aria-label="Favorite workflow" />}
      <span className="flex-1 min-w-0 truncate text-text-primary">{run.title}</span>
      {run.attempt > 1 && <span className="shrink-0 px-1 rounded bg-elevated text-text-muted">#{run.attempt}</span>}
      {run.branch && (
        <span className="shrink-0 max-w-[10rem] truncate px-1.5 rounded bg-accent-soft text-accent font-mono">{run.branch}</span>
      )}
      <span className="shrink-0 px-1.5 rounded bg-elevated border border-border-subtle text-text-muted">{run.event}</span>
      {run.actor && <span className="shrink-0 text-text-muted truncate max-w-[8rem]">{run.actor}</span>}
      {duration && <span className="shrink-0 font-mono text-text-muted">{duration}</span>}
      {!Number.isNaN(created) && <span className="shrink-0 text-text-muted w-16 text-right">{timeAgo(created, Date.now())}</span>}
    </div>
  );
}

export default function ActionsScreen() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const repoPath = activeRepo?.path;
  const { status, branches, isLoadingBranches, loadBranches, assignableUsers, isLoadingAssignableUsers, loadAssignableUsers } =
    useGithubStore();
  const runs = useActionsStore((s) => s.runs);
  const hasMore = useActionsStore((s) => s.hasMore);
  const isLoading = useActionsStore((s) => s.isLoading);
  const isLoadingMore = useActionsStore((s) => s.isLoadingMore);
  const error = useActionsStore((s) => s.error);
  const workflows = useActionsStore((s) => s.workflows);
  const filters = useActionsStore((s) => s.filters);
  const selectedRunId = useActionsStore((s) => s.selectedRunId);
  const { setFilter, clearFilters, loadRuns, loadMore, loadWorkflows, refresh, openRun, reset } = useActionsStore.getState();

  const prefs = useCiPrefsStore((s) => (repoPath ? s.getPrefs(repoPath) : undefined));
  const setFavoritesOnly = useCiPrefsStore((s) => s.setFavoritesOnly);
  const names = prefs?.names;
  const favorites = prefs?.favorites;
  const favoritesOnly = !!prefs?.favoritesOnly;

  const available = !status || status.available;

  useEffect(() => {
    reset();
    if (repoPath && available) {
      void loadRuns(repoPath);
      void loadWorkflows(repoPath);
      void loadBranches(repoPath);
      void loadAssignableUsers(repoPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, status?.available]);

  const anyRunning = runs.some((r) => r.status !== "completed");
  useEffect(() => {
    if (!repoPath || !available || !anyRunning) return;
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh(repoPath);
    }, ACTIONS_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, available, anyRunning]);

  const visible = useMemo(
    () => (favoritesOnly ? runs.filter((r) => favorites?.includes(r.workflowId)) : runs),
    [runs, favoritesOnly, favorites]
  );
  const hidden = runs.length - visible.length;

  if (!repoPath) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={<FolderGit2 size={18} />}
          title="No repository selected"
          hint="Add a repository in the sidebar, or pick one you already added, to see its workflow runs."
        />
      </div>
    );
  }

  if (status && !status.available) {
    const info = describeGithubUnavailable(status.reason, status.owner != null);
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState icon={<PlugZap size={18} />} title={info.title} hint={info.hint} details={status.reason ?? undefined} />
      </div>
    );
  }

  if (selectedRunId != null) return <ActionRunDetail />;

  const anyFilter = Object.values(filters).some((v) => v !== "" && v !== null);
  const titleFor = (r: RunSummary) => workflowTitle(r.workflowName, names?.[r.workflowId]).title;

  const renderError = () => {
    if (!error) return null;
    const retry = { label: "Retry", onClick: () => void loadRuns(repoPath) };
    if (error.kind === "no-gh" || error.kind === "unauthenticated") {
      const info = describeGithubUnavailable(error.message, true);
      return <EmptyState variant="error" title={info.title} hint={info.hint} details={error.message} action={retry} />;
    }
    if (error.kind === "rate-limited") {
      return (
        <EmptyState variant="error" title="GitHub rate limit reached" hint="Wait a few minutes and try again." details={shortCiError(error.message)} action={retry} />
      );
    }
    if (error.kind === "forbidden") {
      return (
        <EmptyState variant="error" title="Access denied" hint="Your GitHub account can't read workflow runs for this repository." details={shortCiError(error.message)} action={retry} />
      );
    }
    return <EmptyState variant="error" title="Couldn't load workflow runs" details={shortCiError(error.message)} action={retry} />;
  };

  const renderBody = () => {
    if (error) return renderError();
    if (isLoading && runs.length === 0) {
      return (
        <div className="p-3 flex flex-col gap-3" data-testid="runs-skeleton">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonBlock key={i} lines={1} />
          ))}
        </div>
      );
    }
    if (isLoading) return null;
    if (runs.length === 0) {
      return anyFilter ? (
        <EmptyState
          icon={<SearchX size={18} />}
          title="No workflow runs"
          hint="No runs match these filters."
          action={{ label: "Clear filters", onClick: clearFilters }}
        />
      ) : (
        <EmptyState icon={<PlayCircle size={18} />} title="No workflow runs" hint="This repository has no workflow runs yet." />
      );
    }
    if (favoritesOnly && visible.length === 0) {
      return (
        <EmptyState
          icon={<Star size={18} />}
          title={favorites && favorites.length > 0 ? "No runs from starred workflows" : "No starred workflows"}
          hint={
            favorites && favorites.length > 0
              ? "None of the loaded runs belong to a starred workflow."
              : "Star a workflow in a commit's Checks tab to see it here"
          }
          action={{ label: "Show all", onClick: () => setFavoritesOnly(repoPath, false) }}
        />
      );
    }
    return null;
  };

  const body = renderBody();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border-subtle text-xs">
        <div role="group" aria-label="Status" className="flex rounded border border-border-subtle overflow-hidden">
          {STATUS_OPTIONS.map((o, i) => (
            <button
              key={o.value}
              type="button"
              aria-label={o.label}
              aria-pressed={filters.status === o.value}
              className={`px-2 py-1 text-xs ${i > 0 ? "border-l border-border-subtle" : ""} ${
                filters.status === o.value ? "bg-accent text-accent-contrast" : "bg-elevated text-text-primary"
              }`}
              onClick={() => setFilter("status", o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Workflow"
          className={`${SELECT} max-w-[12rem]`}
          value={filters.workflowId ?? ""}
          onChange={(e) => setFilter("workflowId", e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">All workflows</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {workflowTitle(w.name, names?.[w.id]).title}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-text-muted">
          Branch
          <BranchCombobox
            value={filters.branch ?? undefined}
            onChange={(v) => setFilter("branch", v)}
            branches={branches}
            isLoading={isLoadingBranches}
          />
        </label>
        <label className="flex items-center gap-1 text-text-muted">
          Actor
          <UserCombobox
            value={filters.actor ?? undefined}
            onChange={(v) => setFilter("actor", v)}
            options={assignableUsers}
            isLoading={isLoadingAssignableUsers}
          />
        </label>
        <select
          aria-label="Event"
          className={SELECT}
          value={filters.event ?? ""}
          onChange={(e) => setFilter("event", e.target.value || null)}
        >
          <option value="">All events</option>
          {EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Favorites only"
          aria-pressed={favoritesOnly}
          title="Favorites only"
          className={`px-2 py-1 rounded border flex items-center gap-1 ${
            favoritesOnly ? "bg-accent text-accent-contrast border-accent" : "bg-elevated text-text-primary border-border-subtle"
          }`}
          onClick={() => setFavoritesOnly(repoPath, !favoritesOnly)}
        >
          <Star size={12} fill={favoritesOnly ? "currentColor" : "none"} />
        </button>
        <div className="flex-1" />
        <span className="text-text-muted" data-testid="runs-count">
          {visible.length} {visible.length === 1 ? "run" : "runs"}
          {hidden > 0 ? ` · ${hidden} hidden` : ""}
        </span>
        <button
          type="button"
          aria-label="Refresh runs"
          title="Refresh runs"
          disabled={isLoading}
          className="px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary disabled:opacity-60 hover:bg-hover"
          onClick={() => void loadRuns(repoPath)}
        >
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {body}
        {!error && visible.length > 0 && (
          <div className={isLoading ? "opacity-60" : ""}>
            {visible.map((r) => (
              <RunRow
                key={r.runId}
                run={r}
                title={titleFor(r)}
                favorite={!!favorites?.includes(r.workflowId)}
                onOpen={() => openRun(r.runId)}
              />
            ))}
          </div>
        )}
        {!error && hasMore && (
          <div className="p-2 flex justify-center">
            <button
              type="button"
              disabled={isLoadingMore}
              className="px-3 py-1 text-xs bg-elevated border border-border-subtle rounded text-text-primary hover:bg-hover disabled:opacity-60 flex items-center gap-1"
              onClick={() => void loadMore(repoPath)}
            >
              {isLoadingMore && <Loader2 size={12} className="animate-spin" />}
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
