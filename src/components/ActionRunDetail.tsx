import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ExternalLink, GitCommitHorizontal } from "lucide-react";
import type { CiJob, CiWorkflowRun, RunSummary } from "../lib/tauri";
import { formatDuration, runState, workflowTitle } from "../lib/ci";
import { timeAgo } from "../lib/timeAgo";
import { jumpToCommit } from "../lib/branchActions";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useViewStore } from "../store/viewStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { ACTIONS_POLL_MS, useActionsStore } from "../store/actionsStore";
import { toast } from "../store/toastStore";
import { SkeletonBlock } from "./Skeleton";
import WorkflowCard, { StateIcon } from "./WorkflowCard";
import LogViewer from "./LogViewer";

const NO_JOBS: CiJob[] = [];
const BUTTON =
  "inline-flex items-center gap-1 px-2 py-1 rounded border border-border-subtle bg-elevated text-xs text-text-primary hover:bg-hover hover:border-accent transition-colors duration-100 press-scale";

export function toWorkflowRun(run: RunSummary, jobs: CiJob[]): CiWorkflowRun {
  return {
    runId: run.runId,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    status: run.status,
    conclusion: run.conclusion,
    url: run.url,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    jobs,
  };
}

export default function ActionRunDetail() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const repoPath = repos.find((r) => r.id === activeRepoId)?.path;
  const selectedRunId = useActionsStore((s) => s.selectedRunId);
  const listRun = useActionsStore((s) => s.runs.find((r) => r.runId === s.selectedRunId));
  const jobs = useActionsStore((s) => (s.selectedRunId != null ? s.jobsByRun[s.selectedRunId] : undefined));
  const jobsError = useActionsStore((s) => s.jobsError);
  const { closeRun, loadJobs, rerun, cancel } = useActionsStore.getState();
  const setActiveView = useViewStore((s) => s.setActiveView);
  const customName = useCiPrefsStore((s) => (repoPath && listRun ? s.getPrefs(repoPath).names[listRun.workflowId] : undefined));
  const [openJob, setOpenJob] = useState<{ job: CiJob; run: CiWorkflowRun } | null>(null);

  // A refresh can drop the run from a filtered list; keep showing the last known copy.
  const lastRun = useRef<RunSummary | undefined>(undefined);
  if (listRun) lastRun.current = listRun;
  const run = listRun ?? lastRun.current;

  const status = run?.status;
  const conclusion = run?.conclusion;

  useEffect(() => {
    if (repoPath && selectedRunId != null) void loadJobs(repoPath, selectedRunId);
    // status/conclusion changes make the cached jobs stale (loadJobs decides whether to refetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, selectedRunId, status, conclusion]);

  useEffect(() => {
    if (!repoPath || selectedRunId == null || status === "completed") return;
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadJobs(repoPath, selectedRunId, true);
    }, ACTIONS_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, selectedRunId, status]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role='dialog']")) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      closeRun();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const workflowRun = useMemo(() => (run ? toWorkflowRun(run, jobs ?? NO_JOBS) : null), [run, jobs]);

  if (!run || !workflowRun || !repoPath) return null;

  const { title } = workflowTitle(run.workflowName, customName);
  const state = runState(workflowRun);
  const created = Date.parse(run.createdAt);
  const duration = run.status === "completed" ? formatDuration(run.startedAt ?? run.createdAt, run.updatedAt) : "";

  const showCommit = async () => {
    setActiveView("repo");
    await jumpToCommit(run.sha);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
          onClick={closeRun}
        >
          <ArrowLeft size={14} /> Actions
        </button>
        <div className="flex-1" />
        <button
          type="button"
          className={BUTTON}
          onClick={() => openUrl(run.url).catch((err) => toast.error(`Failed to open run: ${err}`))}
        >
          <ExternalLink size={12} /> Open on GitHub
        </button>
        <button type="button" className={BUTTON} onClick={() => void showCommit()}>
          <GitCommitHorizontal size={12} /> Show commit
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <StateIcon state={state} size={16} />
            <h2 className="text-sm font-semibold text-text-primary truncate">{title}</h2>
            {run.attempt > 1 && <span className="text-[11px] px-1.5 rounded bg-elevated text-text-muted">#{run.attempt}</span>}
          </div>
          <div className="text-text-primary text-sm">{run.title}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            {run.branch && <span className="px-1.5 rounded bg-accent-soft text-accent font-mono">{run.branch}</span>}
            <span className="px-1.5 rounded bg-elevated border border-border-subtle">{run.event}</span>
            {run.actor && <span>{run.actor}</span>}
            {!Number.isNaN(created) && <span>{timeAgo(created, Date.now())}</span>}
            {duration && <span className="font-mono">{duration}</span>}
            <span>{run.status === "completed" ? (run.conclusion ?? "completed") : run.status.replace("_", " ")}</span>
          </div>
        </div>
        {jobs === undefined && !jobsError && <SkeletonBlock lines={3} />}
        {jobsError && jobs === undefined && <div className="text-xs text-danger">Couldn't load jobs: {jobsError}</div>}
        {(jobs !== undefined || jobsError) && (
          <WorkflowCard
            repoPath={repoPath}
            run={workflowRun}
            onOpenJob={(job, r) => setOpenJob({ job, run: r })}
            onRerun={(id, failedOnly) => rerun(repoPath, id, failedOnly)}
            onCancel={(id) => cancel(repoPath, id)}
          />
        )}
      </div>
      {openJob && <LogViewer repoPath={repoPath} job={openJob.job} run={openJob.run} onClose={() => setOpenJob(null)} />}
    </div>
  );
}
