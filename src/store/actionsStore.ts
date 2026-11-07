import { create } from "zustand";
import {
  invokeCiCancel,
  invokeCiListRuns,
  invokeCiListWorkflows,
  invokeCiRerun,
  invokeCiRunJobs,
  type CiJob,
  type RunFilters,
  type RunSummary,
  type WorkflowInfo,
} from "../lib/tauri";
import { classifyCiError, type CiErrorKind } from "../lib/ciErrors";
import { toast } from "./toastStore";

export interface ActionsFilters {
  status: "" | "failure" | "success" | "in_progress";
  workflowId: number | null;
  branch: string | null;
  actor: string | null;
  event: string | null;
}

const EMPTY_FILTERS: ActionsFilters = { status: "", workflowId: null, branch: null, actor: null, event: null };

interface State {
  repoPath: string | null;
  runs: RunSummary[];
  hasMore: boolean;
  page: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: { kind: CiErrorKind; message: string } | null;
  workflows: WorkflowInfo[];
  filters: ActionsFilters;
  selectedRunId: number | null;
  jobsByRun: Record<number, CiJob[]>;
  /** Runs whose cached jobs were fetched while still active, so they must be refetched. */
  staleJobs: Record<number, true>;
  jobsError: string | null;
  setFilter: <K extends keyof ActionsFilters>(key: K, value: ActionsFilters[K]) => void;
  clearFilters: () => void;
  loadRuns: (repoPath: string) => Promise<void>;
  loadMore: (repoPath: string) => Promise<void>;
  loadWorkflows: (repoPath: string) => Promise<void>;
  refresh: (repoPath: string) => Promise<void>;
  openRun: (runId: number) => void;
  closeRun: () => void;
  loadJobs: (repoPath: string, runId: number, force?: boolean) => Promise<void>;
  rerun: (repoPath: string, runId: number, failedOnly: boolean) => Promise<void>;
  cancel: (repoPath: string, runId: number) => Promise<void>;
  reset: () => void;
}

export const ACTIONS_POLL_MS = 15_000;

export function toRunFilters(f: ActionsFilters, page: number): RunFilters {
  const out: RunFilters = { page };
  if (f.status) out.status = f.status;
  if (f.workflowId != null) out.workflowId = f.workflowId;
  if (f.branch) out.branch = f.branch;
  if (f.actor) out.actor = f.actor;
  if (f.event) out.event = f.event;
  return out;
}

// Bumped on every reload/reset so responses for an older request are ignored.
let requestId = 0;

export const useActionsStore = create<State>((set, get) => ({
  repoPath: null,
  runs: [],
  hasMore: false,
  page: 1,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  workflows: [],
  filters: { ...EMPTY_FILTERS },
  selectedRunId: null,
  jobsByRun: {},
  staleJobs: {},
  jobsError: null,
  setFilter: (key, value) => {
    set({ filters: { ...get().filters, [key]: value } });
    const { repoPath } = get();
    if (repoPath) void get().loadRuns(repoPath);
  },
  clearFilters: () => {
    set({ filters: { ...EMPTY_FILTERS } });
    const { repoPath } = get();
    if (repoPath) void get().loadRuns(repoPath);
  },
  loadRuns: async (repoPath) => {
    const id = ++requestId;
    set({ repoPath, isLoading: true, isLoadingMore: false, error: null, page: 1 });
    try {
      const res = await invokeCiListRuns(repoPath, toRunFilters(get().filters, 1));
      if (id !== requestId) return;
      set({ runs: res.runs, hasMore: res.hasMore, isLoading: false });
    } catch (e) {
      if (id !== requestId) return;
      const message = String(e);
      set({ runs: [], hasMore: false, isLoading: false, error: { kind: classifyCiError(message).kind, message } });
    }
  },
  loadMore: async (repoPath) => {
    const { isLoadingMore, isLoading, hasMore, page } = get();
    if (isLoadingMore || isLoading || !hasMore) return;
    const id = requestId;
    set({ isLoadingMore: true });
    try {
      const res = await invokeCiListRuns(repoPath, toRunFilters(get().filters, page + 1));
      if (id !== requestId) return;
      const seen = new Set(get().runs.map((r) => r.runId));
      set({
        runs: [...get().runs, ...res.runs.filter((r) => !seen.has(r.runId))],
        hasMore: res.hasMore,
        page: page + 1,
        isLoadingMore: false,
      });
    } catch (e) {
      if (id !== requestId) return;
      set({ isLoadingMore: false });
      toast.error(`Couldn't load more runs: ${e}`);
    }
  },
  loadWorkflows: async (repoPath) => {
    const id = requestId;
    try {
      const workflows = await invokeCiListWorkflows(repoPath);
      if (id !== requestId) return;
      set({ workflows });
    } catch {
      // The workflow filter just stays empty; the run list reports real errors.
    }
  },
  refresh: async (repoPath) => {
    const id = requestId;
    const { filters, page } = get();
    try {
      // Re-fetch every page the user has loaded so shifted/finished rows are replaced, never left stale.
      const seen = new Set<number>();
      const runs: RunSummary[] = [];
      let hasMore = false;
      for (let p = 1; p <= page; p++) {
        const res = await invokeCiListRuns(repoPath, toRunFilters(filters, p));
        if (id !== requestId) return;
        for (const r of res.runs) {
          if (!seen.has(r.runId)) {
            seen.add(r.runId);
            runs.push(r);
          }
        }
        hasMore = res.hasMore;
      }
      // A loadMore that finished (page moved) or is still running owns the list; its data is already right.
      if (get().page !== page || get().isLoadingMore) return;
      set({ runs, hasMore });
    } catch {
      // Silent: a failed background refresh keeps what is on screen.
    }
  },
  openRun: (runId) => set({ selectedRunId: runId, jobsError: null }),
  closeRun: () => set({ selectedRunId: null, jobsError: null }),
  loadJobs: async (repoPath, runId, force = false) => {
    const { jobsByRun, staleJobs } = get();
    if (!force && jobsByRun[runId] && !staleJobs[runId]) return;
    const id = requestId;
    try {
      const jobs = await invokeCiRunJobs(repoPath, runId);
      if (id !== requestId) return;
      const active = get().runs.find((r) => r.runId === runId)?.status !== "completed";
      const nextStale = { ...get().staleJobs };
      if (active) nextStale[runId] = true;
      else delete nextStale[runId];
      set({ jobsByRun: { ...get().jobsByRun, [runId]: jobs }, staleJobs: nextStale, jobsError: null });
    } catch (e) {
      if (id !== requestId) return;
      set({ jobsError: String(e) });
    }
  },
  rerun: async (repoPath, runId, failedOnly) => {
    try {
      await invokeCiRerun(repoPath, runId, failedOnly);
      toast.success(failedOnly ? "Re-running failed jobs" : "Re-running workflow");
    } catch (e) {
      toast.error(`Re-run failed: ${e}`);
      return;
    }
    await get().refresh(repoPath);
    await get().loadJobs(repoPath, runId, true);
  },
  cancel: async (repoPath, runId) => {
    try {
      await invokeCiCancel(repoPath, runId);
      toast.success("Cancelling workflow");
    } catch (e) {
      toast.error(`Cancel failed: ${e}`);
      return;
    }
    await get().refresh(repoPath);
    await get().loadJobs(repoPath, runId, true);
  },
  reset: () => {
    requestId++;
    set({
      repoPath: null,
      runs: [],
      hasMore: false,
      page: 1,
      isLoading: false,
      isLoadingMore: false,
      error: null,
      workflows: [],
      filters: { ...EMPTY_FILTERS },
      selectedRunId: null,
      jobsByRun: {},
      staleJobs: {},
      jobsError: null,
    });
  },
}));
