import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, Pencil, Star, XCircle } from "lucide-react";
import type { CiJob, CiState, CiWorkflowRun } from "../lib/tauri";
import { formatDuration, runState, workflowTitle } from "../lib/ci";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { useCiChecksStore } from "../store/ciChecksStore";
import { toast } from "../store/toastStore";

const CONFIRM_RESET_MS = 4000;

const ACTION_BUTTON =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border-subtle bg-elevated text-text-muted hover:text-text-primary hover:bg-hover hover:border-accent transition-colors duration-100 press-scale disabled:opacity-60";

export function StateIcon({ state, size = 14 }: { state: CiState; size?: number }) {
  if (state === "success") return <CheckCircle2 size={size} className="text-success shrink-0" />;
  if (state === "failure") return <XCircle size={size} className="text-danger shrink-0" />;
  if (state === "pending") return <Loader2 size={size} className="text-merged shrink-0 animate-spin" />;
  return <span className="inline-block shrink-0 rounded-full bg-border-subtle" style={{ width: size, height: size }} />;
}

function jobState(job: CiJob): CiState {
  if (job.status !== "completed") return "pending";
  const c = (job.conclusion ?? "").toLowerCase();
  if (c === "success" || c === "neutral" || c === "skipped") return "success";
  return c === "" ? "pending" : "failure";
}

function jobSeconds(job: CiJob): number {
  if (!job.startedAt || !job.completedAt) return 0;
  const s = (Date.parse(job.completedAt) - Date.parse(job.startedAt)) / 1000;
  return Number.isNaN(s) ? 0 : Math.max(0, s);
}

interface Props {
  repoPath: string;
  run: CiWorkflowRun;
  onOpenJob: (job: CiJob, run: CiWorkflowRun) => void;
  /** Override the commit-checks store actions (used outside the commit drawer, e.g. the Actions screen). */
  onRerun?: (runId: number, failedOnly: boolean) => Promise<void>;
  onCancel?: (runId: number) => Promise<void>;
}

export default function WorkflowCard({ repoPath, run, onOpenJob, onRerun, onCancel }: Props) {
  const customName = useCiPrefsStore((s) => s.getPrefs(repoPath).names[run.workflowId]);
  const favorite = useCiPrefsStore((s) => s.getPrefs(repoPath).favorites.includes(run.workflowId));
  const setName = useCiPrefsStore((s) => s.setName);
  const toggleFavorite = useCiPrefsStore((s) => s.toggleFavorite);
  const storeRerun = useCiChecksStore((s) => s.rerun);
  const storeCancel = useCiChecksStore((s) => s.cancel);
  const rerun = onRerun ?? storeRerun;
  const cancel = onCancel ?? storeCancel;

  const state = runState(run);
  const { title, original } = workflowTitle(run.workflowName, customName);
  const [expanded, setExpanded] = useState(state === "failure");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Enter commits then unmounts the input, which fires blur; guard against a double commit/cancel.
  const finished = useRef(false);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [pressed, setPressed] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPressed(key);
    try {
      await action();
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        setPressed(null);
      }
    }
  };
  const spinner = (key: string) => (pressed === key ? <Loader2 size={12} className="animate-spin" /> : null);

  const startEdit = () => {
    finished.current = false;
    setDraft(customName ?? run.workflowName);
    setEditing(true);
  };
  const commit = () => {
    if (finished.current) return;
    finished.current = true;
    setName(repoPath, run.workflowId, draft);
    setEditing(false);
  };
  const cancelEdit = () => {
    finished.current = true;
    setEditing(false);
  };

  const onCancelClick = () => {
    if (!confirming) {
      setConfirming(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirming(false), CONFIRM_RESET_MS);
      return;
    }
    clearTimeout(timer.current);
    setConfirming(false);
    void runAction("cancel", () => cancel(run.runId));
  };

  const duration = formatDuration(run.startedAt, run.updatedAt);
  const longest = Math.max(1, ...run.jobs.map(jobSeconds));

  return (
    <div className="shrink-0 border border-border-subtle rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-elevated">
        <button
          type="button"
          className="text-text-muted hover:text-text-primary"
          aria-label={expanded ? "Collapse workflow" : "Expand workflow"}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <StateIcon state={state} />
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          {editing ? (
            <input
              aria-label="Workflow name"
              autoFocus
              className="flex-1 min-w-0 px-1 py-0.5 bg-surface border border-border-subtle rounded text-sm text-text-primary outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") {
                  e.stopPropagation();
                  cancelEdit();
                }
              }}
            />
          ) : (
            <>
              <span data-testid="workflow-title" className="text-sm font-medium text-text-primary truncate">
                {title}
              </span>
              {original && <span className="text-xs text-text-muted truncate">{original}</span>}
            </>
          )}
        </div>
        {duration && <span className="text-xs text-text-muted font-mono">{duration}</span>}
        <button
          type="button"
          className="text-text-muted hover:text-text-primary press-scale"
          aria-label="Rename workflow"
          title="Rename workflow"
          onClick={startEdit}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className={`press-scale ${favorite ? "text-accent" : "text-text-muted hover:text-text-primary"}`}
          aria-label="Favorite workflow"
          aria-pressed={favorite}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => toggleFavorite(repoPath, run.workflowId)}
        >
          <Star size={12} fill={favorite ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          className="text-text-muted hover:text-text-primary press-scale"
          aria-label="Open workflow run on GitHub"
          title="Open on GitHub"
          onClick={() => openUrl(run.url).catch((err) => toast.error(`Failed to open run: ${err}`))}
        >
          <ExternalLink size={12} />
        </button>
      </div>
      {expanded && (
        <div className="px-3 py-2 flex flex-col gap-1">
          {run.jobs.length === 0 && <div className="text-xs text-text-muted">No jobs reported yet</div>}
          {run.jobs.map((job) => {
            const secs = jobSeconds(job);
            return (
              <button
                type="button"
                key={job.jobId}
                className="flex items-center gap-2 px-1 py-0.5 rounded text-left text-xs hover:bg-hover"
                onClick={() => onOpenJob(job, run)}
              >
                <StateIcon state={jobState(job)} size={12} />
                <span className="flex-1 min-w-0 truncate text-text-primary">{job.name}</span>
                <span className="w-24 h-1.5 rounded bg-border-subtle overflow-hidden shrink-0" aria-hidden>
                  <span className="block h-full bg-accent" style={{ width: `${(secs / longest) * 100}%` }} />
                </span>
                <span className="w-14 text-right font-mono text-text-muted">{formatDuration(job.startedAt, job.completedAt)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border-subtle">
        {run.status === "completed" ? (
          <>
            {state === "failure" && (
              <button type="button" className={ACTION_BUTTON} disabled={busy} onClick={() => void runAction("failed", () => rerun(run.runId, true))}>
                {spinner("failed")}Re-run failed jobs
              </button>
            )}
            <button type="button" className={ACTION_BUTTON} disabled={busy} onClick={() => void runAction("all", () => rerun(run.runId, false))}>
              {spinner("all")}Re-run all
            </button>
          </>
        ) : (
          <button type="button" className={`${ACTION_BUTTON} ${confirming ? "!text-danger !border-danger" : ""}`} disabled={busy} onClick={onCancelClick}>
            {spinner("cancel")}{confirming ? "Confirm cancel" : "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
