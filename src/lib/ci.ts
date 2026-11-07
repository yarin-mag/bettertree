import type { CiJob, CiState, CiWorkflowRun, CommitCi } from "./tauri";

export function workflowTitle(name: string, custom: string | undefined): { title: string; original: string | null } {
  const trimmed = custom?.trim();
  const base = name.trim() || "Workflow";
  if (trimmed) return { title: trimmed, original: name.trim() || null };
  return { title: base, original: null };
}

export function runState(run: Pick<CiWorkflowRun, "status" | "conclusion">): CiState {
  if (run.status !== "completed") return "pending";
  switch ((run.conclusion ?? "").toLowerCase()) {
    case "success": case "neutral": case "skipped": return "success";
    case "": return "pending";
    default: return "failure";
  }
}

const RANK: Record<CiState, number> = { failure: 0, pending: 1, success: 2, none: 3 };

export function sortRuns(runs: CiWorkflowRun[]): CiWorkflowRun[] {
  return [...runs].sort((a, b) => RANK[runState(a)] - RANK[runState(b)] || a.workflowName.localeCompare(b.workflowName));
}

export function badgeState(ci: CommitCi, opts: { favorites: number[]; followFavorites: boolean }): CiState {
  if (!opts.followFavorites || opts.favorites.length === 0) return ci.state;
  const mine = ci.byWorkflow.filter((w) => opts.favorites.includes(w.workflowId) && w.state !== "none");
  if (mine.length === 0) return ci.state;
  if (mine.some((w) => w.state === "failure")) return "failure";
  if (mine.some((w) => w.state === "pending")) return "pending";
  return "success";
}

function favoritesApplied(ci: CommitCi, opts: { favorites: number[]; followFavorites: boolean }): boolean {
  if (!opts.followFavorites || opts.favorites.length === 0) return false;
  return ci.byWorkflow.some((w) => opts.favorites.includes(w.workflowId) && w.state !== "none");
}

export function badgeTitle(ci: CommitCi, opts: { favorites: number[]; followFavorites: boolean }): string {
  const counts = ci.failed > 0 ? `${ci.failed} of ${ci.total} failed` : ci.pending > 0 ? `${ci.pending} of ${ci.total} running` : `${ci.total} checks passed`;
  return favoritesApplied(ci, opts) ? `${counts} (favorites only)` : counts;
}

export function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return "";
  const seconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
  if (Number.isNaN(seconds)) return "";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function firstFailedStep(job: CiJob): number | null {
  const step = job.steps.find((s) => (s.conclusion ?? "").toLowerCase() === "failure");
  return step ? step.number : null;
}

// `gh run view --log` prints "<job>\t<step>\t<timestamp> <content>" per line.
export function parseLogSteps(text: string): { stepName: string; lines: string[] }[] {
  const out: { stepName: string; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    if (raw === "") continue;
    const parts = raw.split("\t");
    let stepName = "Output";
    let content = raw;
    if (parts.length >= 3) {
      stepName = parts[1];
      content = parts.slice(2).join("\t").replace(/^\S+\s/, "");
    }
    const last = out[out.length - 1];
    if (last && last.stepName === stepName) last.lines.push(content);
    else out.push({ stepName, lines: [content] });
  }
  return out;
}
