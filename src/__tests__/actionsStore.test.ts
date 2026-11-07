import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeCiListRuns: vi.fn(),
  invokeCiListWorkflows: vi.fn(),
  invokeCiRunJobs: vi.fn(),
  invokeCiRerun: vi.fn(),
  invokeCiCancel: vi.fn(),
}));

import * as tauriLib from "../lib/tauri";
import { useActionsStore } from "../store/actionsStore";
import { useToastStore } from "../store/toastStore";

const listRuns = tauriLib.invokeCiListRuns as unknown as ReturnType<typeof vi.fn>;
const listWorkflows = tauriLib.invokeCiListWorkflows as unknown as ReturnType<typeof vi.fn>;
const runJobs = tauriLib.invokeCiRunJobs as unknown as ReturnType<typeof vi.fn>;
const rerunInvoke = tauriLib.invokeCiRerun as unknown as ReturnType<typeof vi.fn>;

const run = (runId: number, over: Record<string, unknown> = {}) => ({
  runId, workflowId: 1, workflowName: "CI", title: `run ${runId}`, branch: "main", sha: "abc", event: "push",
  actor: "me", status: "completed", conclusion: "success", createdAt: "2026-01-01T00:00:00Z", startedAt: null,
  updatedAt: null, url: "https://x", attempt: 1, ...over,
});

const initial = useActionsStore.getState();

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("actionsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useActionsStore.setState({ ...initial });
    useActionsStore.getState().reset();
    listRuns.mockResolvedValue({ runs: [], hasMore: false });
    listWorkflows.mockResolvedValue([]);
    runJobs.mockResolvedValue([]);
  });

  it("loadRuns maps empty filters to an omitted set and loads page 1", async () => {
    listRuns.mockResolvedValue({ runs: [run(1)], hasMore: true });
    await useActionsStore.getState().loadRuns("/r");
    expect(listRuns).toHaveBeenCalledWith("/r", { page: 1 });
    const s = useActionsStore.getState();
    expect(s.runs).toHaveLength(1);
    expect(s.hasMore).toBe(true);
    expect(s.isLoading).toBe(false);
  });

  it("setFilter maps filters to RunFilters and reloads from page 1", async () => {
    await useActionsStore.getState().loadRuns("/r");
    await useActionsStore.getState().loadMore("/r");
    useActionsStore.getState().setFilter("status", "failure");
    useActionsStore.getState().setFilter("workflowId", 7);
    useActionsStore.getState().setFilter("branch", "dev");
    useActionsStore.getState().setFilter("actor", "bob");
    useActionsStore.getState().setFilter("event", "push");
    await vi.waitFor(() =>
      expect(listRuns).toHaveBeenLastCalledWith("/r", { status: "failure", workflowId: 7, branch: "dev", actor: "bob", event: "push", page: 1 })
    );
    expect(useActionsStore.getState().page).toBe(1);
  });

  it("loadMore appends the next page and de-dupes by runId", async () => {
    listRuns.mockResolvedValueOnce({ runs: [run(1), run(2)], hasMore: true });
    await useActionsStore.getState().loadRuns("/r");
    listRuns.mockResolvedValueOnce({ runs: [run(2), run(3)], hasMore: false });
    await useActionsStore.getState().loadMore("/r");
    expect(listRuns).toHaveBeenLastCalledWith("/r", { page: 2 });
    const s = useActionsStore.getState();
    expect(s.runs.map((r) => r.runId)).toEqual([1, 2, 3]);
    expect(s.hasMore).toBe(false);
    expect(s.page).toBe(2);
    expect(s.isLoadingMore).toBe(false);
  });

  it("ignores a stale response after a filter change", async () => {
    const slow = deferred<{ runs: unknown[]; hasMore: boolean }>();
    listRuns.mockReturnValueOnce(slow.promise);
    const first = useActionsStore.getState().loadRuns("/r");
    listRuns.mockResolvedValueOnce({ runs: [run(9)], hasMore: false });
    useActionsStore.getState().setFilter("status", "failure");
    await vi.waitFor(() => expect(useActionsStore.getState().runs.map((r) => r.runId)).toEqual([9]));
    slow.resolve({ runs: [run(1)], hasMore: false });
    await first;
    expect(useActionsStore.getState().runs.map((r) => r.runId)).toEqual([9]);
    expect(useActionsStore.getState().isLoading).toBe(false);
  });

  it("reset clears runs, selection and filters, and drops in-flight responses", async () => {
    const slow = deferred<{ runs: unknown[]; hasMore: boolean }>();
    listRuns.mockReturnValueOnce(slow.promise);
    const p = useActionsStore.getState().loadRuns("/a");
    useActionsStore.setState({ selectedRunId: 5, filters: { ...useActionsStore.getState().filters, status: "failure" } });
    useActionsStore.getState().reset();
    slow.resolve({ runs: [run(1)], hasMore: false });
    await p;
    const s = useActionsStore.getState();
    expect(s.runs).toEqual([]);
    expect(s.selectedRunId).toBeNull();
    expect(s.filters.status).toBe("");
  });

  it("refresh merges in place without toggling isLoading", async () => {
    listRuns.mockResolvedValueOnce({ runs: [run(1, { status: "in_progress", conclusion: null }), run(2)], hasMore: false });
    await useActionsStore.getState().loadRuns("/r");
    const seen: boolean[] = [];
    const unsub = useActionsStore.subscribe((s) => seen.push(s.isLoading));
    listRuns.mockResolvedValueOnce({ runs: [run(3), run(1), run(2)], hasMore: false });
    await useActionsStore.getState().refresh("/r");
    unsub();
    expect(seen.every((v) => v === false)).toBe(true);
    expect(useActionsStore.getState().runs.map((r) => r.runId)).toEqual([3, 1, 2]);
    listRuns.mockResolvedValueOnce({ runs: [run(3), run(1, { conclusion: "failure" }), run(2)], hasMore: false });
    await useActionsStore.getState().refresh("/r");
    expect(useActionsStore.getState().runs.find((r) => r.runId === 1)?.status).toBe("completed");
  });

  it("refresh drops rows that left page 1 (shrinking under the Running filter)", async () => {
    const running = (id: number) => run(id, { status: "in_progress", conclusion: null });
    listRuns.mockResolvedValueOnce({ runs: [1, 2, 3, 4, 5].map(running), hasMore: false });
    await useActionsStore.getState().loadRuns("/r");
    listRuns.mockResolvedValueOnce({ runs: [], hasMore: false });
    await useActionsStore.getState().refresh("/r");
    expect(useActionsStore.getState().runs).toEqual([]);
    expect(useActionsStore.getState().runs.some((r) => r.status !== "completed")).toBe(false);

    listRuns.mockResolvedValueOnce({ runs: [1, 2, 3, 4, 5].map(running), hasMore: false });
    await useActionsStore.getState().loadRuns("/r");
    listRuns.mockResolvedValueOnce({ runs: [1, 2, 3].map(running), hasMore: false });
    await useActionsStore.getState().refresh("/r");
    expect(useActionsStore.getState().runs.map((r) => r.runId)).toEqual([1, 2, 3]);
  });

  it("refresh re-fetches pages 1..page so shifted rows are kept exactly once", async () => {
    listRuns.mockResolvedValueOnce({ runs: [run(1), run(2)], hasMore: true });
    await useActionsStore.getState().loadRuns("/r");
    listRuns.mockResolvedValueOnce({ runs: [run(3), run(4)], hasMore: true });
    await useActionsStore.getState().loadMore("/r");
    listRuns.mockClear();
    // A new run N=9 arrives: everything shifts down by one.
    listRuns.mockResolvedValueOnce({ runs: [run(9), run(1)], hasMore: true });
    listRuns.mockResolvedValueOnce({ runs: [run(2), run(3)], hasMore: true });
    await useActionsStore.getState().refresh("/r");
    expect(listRuns.mock.calls.map((c) => c[1].page)).toEqual([1, 2]);
    const s = useActionsStore.getState();
    expect(s.runs.map((r) => r.runId)).toEqual([9, 1, 2, 3]);
    expect(s.hasMore).toBe(true);
    expect(s.page).toBe(2);
  });

  it("refresh keeps the existing rows when any page fails, silently", async () => {
    listRuns.mockResolvedValueOnce({ runs: [run(1), run(2)], hasMore: true });
    await useActionsStore.getState().loadRuns("/r");
    listRuns.mockResolvedValueOnce({ runs: [run(3)], hasMore: false });
    await useActionsStore.getState().loadMore("/r");
    listRuns.mockResolvedValueOnce({ runs: [run(9), run(1)], hasMore: true });
    listRuns.mockRejectedValueOnce("boom");
    await useActionsStore.getState().refresh("/r");
    const s = useActionsStore.getState();
    expect(s.runs.map((r) => r.runId)).toEqual([1, 2, 3]);
    expect(s.error).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("refresh does not drop rows appended by a loadMore that completed while it was running", async () => {
    listRuns.mockResolvedValueOnce({ runs: [run(1)], hasMore: true });
    await useActionsStore.getState().loadRuns("/r");
    listRuns.mockResolvedValueOnce({ runs: [run(2)], hasMore: true });
    await useActionsStore.getState().loadMore("/r");
    expect(useActionsStore.getState().page).toBe(2);
    const p1 = deferred<{ runs: unknown[]; hasMore: boolean }>();
    listRuns.mockReturnValueOnce(p1.promise); // refresh page 1 (held)
    listRuns.mockResolvedValueOnce({ runs: [run(3)], hasMore: false }); // loadMore page 3
    listRuns.mockResolvedValueOnce({ runs: [run(2)], hasMore: true }); // refresh page 2
    const refreshing = useActionsStore.getState().refresh("/r");
    await useActionsStore.getState().loadMore("/r");
    expect(useActionsStore.getState().page).toBe(3);
    p1.resolve({ runs: [run(1)], hasMore: true });
    await refreshing;
    const s = useActionsStore.getState();
    expect(s.runs.map((r) => r.runId)).toEqual([1, 2, 3]);
    expect(s.page).toBe(3);
    expect(s.hasMore).toBe(false);
  });

  it("refresh discards its result while a loadMore is still in flight", async () => {
    listRuns.mockResolvedValueOnce({ runs: [run(1)], hasMore: true });
    await useActionsStore.getState().loadRuns("/r");
    listRuns.mockResolvedValueOnce({ runs: [run(2)], hasMore: true });
    await useActionsStore.getState().loadMore("/r");
    const p3 = deferred<{ runs: unknown[]; hasMore: boolean }>();
    listRuns.mockReturnValueOnce(p3.promise); // loadMore page 3 (held)
    listRuns.mockResolvedValueOnce({ runs: [run(1)], hasMore: true }); // refresh page 1
    listRuns.mockResolvedValueOnce({ runs: [run(2)], hasMore: true }); // refresh page 2
    const more = useActionsStore.getState().loadMore("/r");
    await useActionsStore.getState().refresh("/r");
    expect(useActionsStore.getState().runs.map((r) => r.runId)).toEqual([1, 2]);
    p3.resolve({ runs: [run(3)], hasMore: false });
    await more;
    const s = useActionsStore.getState();
    expect(s.runs.map((r) => r.runId)).toEqual([1, 2, 3]);
    expect(s.page).toBe(3);
    expect(s.hasMore).toBe(false);
  });

  it("ignores a stale refresh when the filter changes while it is in flight", async () => {
    listRuns.mockResolvedValueOnce({ runs: [run(1)], hasMore: false });
    await useActionsStore.getState().loadRuns("/r");
    const slow = deferred<{ runs: unknown[]; hasMore: boolean }>();
    listRuns.mockReturnValueOnce(slow.promise);
    const pending = useActionsStore.getState().refresh("/r");
    listRuns.mockResolvedValueOnce({ runs: [run(7)], hasMore: false });
    useActionsStore.getState().setFilter("status", "failure");
    await vi.waitFor(() => expect(useActionsStore.getState().runs.map((r) => r.runId)).toEqual([7]));
    slow.resolve({ runs: [run(1), run(2)], hasMore: true });
    await pending;
    expect(useActionsStore.getState().runs.map((r) => r.runId)).toEqual([7]);
  });

  it("clears jobsError when a run is opened or closed", () => {
    useActionsStore.setState({ jobsError: "old failure" });
    useActionsStore.getState().openRun(2);
    expect(useActionsStore.getState().jobsError).toBeNull();
    useActionsStore.setState({ jobsError: "again" });
    useActionsStore.getState().closeRun();
    expect(useActionsStore.getState().jobsError).toBeNull();
  });

  it("classifies load errors and does not toast", async () => {
    listRuns.mockRejectedValueOnce("gh: HTTP 403 Forbidden");
    await useActionsStore.getState().loadRuns("/r");
    const s = useActionsStore.getState();
    expect(s.error).toEqual({ kind: "forbidden", message: "gh: HTTP 403 Forbidden" });
    expect(s.isLoading).toBe(false);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("loadWorkflows stores the workflow list", async () => {
    listWorkflows.mockResolvedValue([{ id: 1, name: "CI", state: "active" }]);
    await useActionsStore.getState().loadWorkflows("/r");
    expect(useActionsStore.getState().workflows).toEqual([{ id: 1, name: "CI", state: "active" }]);
  });

  it("loadJobs caches finished runs but refetches runs that were fetched while in progress", async () => {
    listRuns.mockResolvedValueOnce({
      runs: [run(1, { status: "in_progress", conclusion: null }), run(2)], hasMore: false,
    });
    await useActionsStore.getState().loadRuns("/r");
    runJobs.mockResolvedValue([{ jobId: 10 }]);
    await useActionsStore.getState().loadJobs("/r", 2);
    await useActionsStore.getState().loadJobs("/r", 2);
    expect(runJobs).toHaveBeenCalledTimes(1);
    expect(useActionsStore.getState().jobsByRun[2]).toEqual([{ jobId: 10 }]);
    await useActionsStore.getState().loadJobs("/r", 1);
    await useActionsStore.getState().loadJobs("/r", 1);
    expect(runJobs).toHaveBeenCalledTimes(3);
  });

  it("rerun calls the backend, toasts, and refreshes the list and jobs", async () => {
    listRuns.mockResolvedValue({ runs: [run(1)], hasMore: false });
    await useActionsStore.getState().loadRuns("/r");
    rerunInvoke.mockResolvedValue(undefined);
    await useActionsStore.getState().rerun("/r", 1, true);
    expect(rerunInvoke).toHaveBeenCalledWith("/r", 1, true);
    expect(listRuns).toHaveBeenCalledTimes(2);
    expect(runJobs).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.some((t) => t.message === "Re-running failed jobs")).toBe(true);
  });

  it("rerun failure toasts an error and does not refresh", async () => {
    rerunInvoke.mockRejectedValue("nope");
    await useActionsStore.getState().rerun("/r", 1, false);
    expect(listRuns).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.some((t) => t.message.includes("Re-run failed"))).toBe(true);
  });
});
