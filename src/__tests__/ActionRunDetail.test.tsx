import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../lib/tauri", () => ({
  invokeCiListRuns: vi.fn(),
  invokeCiListWorkflows: vi.fn(),
  invokeCiRunJobs: vi.fn(),
  invokeCiRerun: vi.fn(),
  invokeCiCancel: vi.fn(),
  invokeCiJobLog: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../lib/branchActions", () => ({ jumpToCommit: vi.fn().mockResolvedValue(true) }));

import * as tauriLib from "../lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import { jumpToCommit } from "../lib/branchActions";
import ActionRunDetail from "../components/ActionRunDetail";
import { useActionsStore } from "../store/actionsStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { useViewStore } from "../store/viewStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";

const listRuns = tauriLib.invokeCiListRuns as unknown as ReturnType<typeof vi.fn>;
const runJobs = tauriLib.invokeCiRunJobs as unknown as ReturnType<typeof vi.fn>;
const rerunInvoke = tauriLib.invokeCiRerun as unknown as ReturnType<typeof vi.fn>;
const jobLog = tauriLib.invokeCiJobLog as unknown as ReturnType<typeof vi.fn>;

const run = (runId: number, over: Record<string, unknown> = {}) => ({
  runId, workflowId: 1, workflowName: "CI", title: "Fix the build", branch: "main", sha: "abc123", event: "push",
  actor: "me", status: "completed", conclusion: "failure", createdAt: "2026-01-01T00:00:00Z", startedAt: null,
  updatedAt: null, url: "https://github.com/x/runs/1", attempt: 1, ...over,
});
const job = { jobId: 10, name: "build-job", status: "completed", conclusion: "failure", startedAt: null, completedAt: null, url: "", steps: [] };

describe("ActionRunDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useCiPrefsStore.setState({ prefs: {} } as never);
    useToastStore.setState({ toasts: [] });
    useViewStore.setState({ activeView: "actions" });
    useWorkspaceStore.setState({ repos: [{ id: 1, path: "/r", name: "r", pinned: false }], activeRepoId: 1 } as never);
    useActionsStore.getState().reset();
    useActionsStore.setState({ runs: [run(1)], selectedRunId: 1, repoPath: "/r" } as never);
    runJobs.mockResolvedValue([job]);
    listRuns.mockResolvedValue({ runs: [run(1)], hasMore: false });
    jobLog.mockResolvedValue({ text: "build\tStep\t2026-01-01T00:00:00Z hello log line", truncated: false });
  });

  it("shows the header and a WorkflowCard with the run's jobs", async () => {
    render(<ActionRunDetail />);
    expect(await screen.findByText("build-job")).toBeInTheDocument();
    expect(screen.getByText("Fix the build")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-title")).toHaveTextContent("CI");
    expect(runJobs).toHaveBeenCalledWith("/r", 1);
  });

  it("clicking a job opens the log viewer", async () => {
    render(<ActionRunDetail />);
    fireEvent.click(await screen.findByText("build-job"));
    await waitFor(() => expect(jobLog).toHaveBeenCalled());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(jobLog.mock.calls[0][0]).toBe("/r");
    expect(jobLog.mock.calls[0][1]).toBe(10);
  });

  it("Open on GitHub opens the run url", async () => {
    render(<ActionRunDetail />);
    await screen.findByText("build-job");
    (openUrl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: /Open on GitHub/ }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/x/runs/1");
  });

  it("Show commit switches to the repo view and jumps to the sha", async () => {
    render(<ActionRunDetail />);
    await screen.findByText("build-job");
    fireEvent.click(screen.getByRole("button", { name: /Show commit/ }));
    expect(useViewStore.getState().activeView).toBe("repo");
    await waitFor(() => expect(jumpToCommit).toHaveBeenCalledWith("abc123"));
  });

  it("the back button and Escape close the detail", async () => {
    render(<ActionRunDetail />);
    await screen.findByText("build-job");
    fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
    expect(useActionsStore.getState().selectedRunId).toBeNull();
    act(() => useActionsStore.setState({ selectedRunId: 1 } as never));
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(useActionsStore.getState().selectedRunId).toBeNull();
  });

  it("Escape closes only the log viewer when it is open, not the detail", async () => {
    render(<ActionRunDetail />);
    fireEvent.click(await screen.findByText("build-job"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useActionsStore.getState().selectedRunId).toBe(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Re-run success refreshes the list row", async () => {
    rerunInvoke.mockResolvedValue(undefined);
    render(<ActionRunDetail />);
    await screen.findByText("build-job");
    listRuns.mockResolvedValue({ runs: [run(1, { status: "queued", conclusion: null })], hasMore: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Re-run all" }));
    });
    await waitFor(() => expect(useActionsStore.getState().runs[0].status).toBe("queued"));
    expect(rerunInvoke).toHaveBeenCalledWith("/r", 1, false);
    expect(listRuns).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument());
  });
});
