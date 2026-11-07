import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../lib/tauri", () => ({
  invokeGetGithubStatus: vi.fn(),
  invokeListGithubBranches: vi.fn().mockResolvedValue(["main", "dev"]),
  invokeListAssignableUsers: vi.fn().mockResolvedValue(["me", "bob"]),
  invokeCiListRuns: vi.fn(),
  invokeCiListWorkflows: vi.fn(),
  invokeCiRunJobs: vi.fn(),
  invokeCiRerun: vi.fn(),
  invokeCiCancel: vi.fn(),
  invokeCiJobLog: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

import { describeGithubUnavailable } from "../lib/githubUnavailable";
import * as tauriLib from "../lib/tauri";
import ActionsScreen from "../components/ActionsScreen";
import { useActionsStore, ACTIONS_POLL_MS } from "../store/actionsStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { useGithubStore } from "../store/githubStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";

const listRuns = tauriLib.invokeCiListRuns as unknown as ReturnType<typeof vi.fn>;
const listWorkflows = tauriLib.invokeCiListWorkflows as unknown as ReturnType<typeof vi.fn>;
const runJobs = tauriLib.invokeCiRunJobs as unknown as ReturnType<typeof vi.fn>;

const run = (runId: number, over: Record<string, unknown> = {}) => ({
  runId, workflowId: 1, workflowName: "CI", title: `Commit message ${runId}`, branch: "main", sha: "abc", event: "push",
  actor: "me", status: "completed", conclusion: "success", createdAt: "2026-01-01T00:00:00Z", startedAt: null,
  updatedAt: null, url: "https://x", attempt: 1, ...over,
});

const flush = () => act(async () => { await Promise.resolve(); });

describe("ActionsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useCiPrefsStore.setState({ prefs: {} } as never);
    useToastStore.setState({ toasts: [] });
    useActionsStore.getState().reset();
    useWorkspaceStore.setState({ repos: [{ id: 1, path: "/r", name: "r", pinned: false }], activeRepoId: 1 } as never);
    useGithubStore.setState({ status: { available: true, owner: "acme", repo: "w", reason: null } } as never);
    listRuns.mockResolvedValue({ runs: [], hasMore: false });
    listWorkflows.mockResolvedValue([{ id: 1, name: "CI", state: "active" }, { id: 2, name: "Deploy", state: "active" }]);
    runJobs.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders rows with custom name, favorite star, branch and event", async () => {
    listRuns.mockResolvedValue({ runs: [run(1), run(2, { workflowId: 2, workflowName: "Deploy", branch: null, event: "schedule" })], hasMore: false });
    useCiPrefsStore.setState({ prefs: { "/r": { names: { 1: "Main pipeline" }, favorites: [1], favoritesOnly: false, badgeFollowsFavorites: true } } } as never);
    render(<ActionsScreen />);
    const rows = await screen.findAllByTestId("run-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Main pipeline");
    expect(rows[0]).toHaveTextContent("Commit message 1");
    expect(rows[0]).toHaveTextContent("main");
    expect(rows[0]).toHaveTextContent("push");
    expect(rows[0].querySelector("[aria-label='Favorite workflow']")).not.toBeNull();
    expect(rows[1]).toHaveTextContent("Deploy");
    expect(rows[1]).toHaveTextContent("schedule");
    expect(rows[1].querySelector("[aria-label='Favorite workflow']")).toBeNull();
  });

  it("shows a loading skeleton on first load", async () => {
    let resolve!: (v: unknown) => void;
    listRuns.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ActionsScreen />);
    expect(screen.getByTestId("runs-skeleton")).toBeInTheDocument();
    await act(async () => resolve({ runs: [], hasMore: false }));
    expect(screen.queryByTestId("runs-skeleton")).not.toBeInTheDocument();
  });

  it("the Failed status filter queries the backend with status failure", async () => {
    render(<ActionsScreen />);
    await screen.findByText("No workflow runs");
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith("/r", { status: "failure", page: 1 }));
  });

  it("the workflow select lists custom names and filters by workflowId", async () => {
    useCiPrefsStore.setState({ prefs: { "/r": { names: { 2: "Ship it" }, favorites: [], favoritesOnly: false, badgeFollowsFavorites: true } } } as never);
    render(<ActionsScreen />);
    await screen.findByRole("option", { name: "Ship it" });
    fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "2" } });
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith("/r", { workflowId: 2, page: 1 }));
  });

  it("the event select filters by event", async () => {
    render(<ActionsScreen />);
    await screen.findByText("No workflow runs");
    fireEvent.change(screen.getByLabelText("Event"), { target: { value: "push" } });
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith("/r", { event: "push", page: 1 }));
  });

  it("favorites-only hides non-favorites and shows how many are hidden", async () => {
    listRuns.mockResolvedValue({ runs: [run(1), run(2, { workflowId: 2, workflowName: "Deploy" })], hasMore: false });
    useCiPrefsStore.setState({ prefs: { "/r": { names: {}, favorites: [1], favoritesOnly: false, badgeFollowsFavorites: true } } } as never);
    render(<ActionsScreen />);
    await screen.findAllByTestId("run-row");
    fireEvent.click(screen.getByLabelText("Favorites only"));
    expect(screen.getAllByTestId("run-row")).toHaveLength(1);
    expect(screen.getByTestId("runs-count")).toHaveTextContent("1 hidden");
    expect(useCiPrefsStore.getState().getPrefs("/r").favoritesOnly).toBe(true);
  });

  it("hints to star a workflow when favorites-only is on and nothing is starred", async () => {
    listRuns.mockResolvedValue({ runs: [run(1)], hasMore: false });
    render(<ActionsScreen />);
    await screen.findAllByTestId("run-row");
    fireEvent.click(screen.getByLabelText("Favorites only"));
    expect(screen.getByText("Star a workflow in a commit's Checks tab to see it here")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getAllByTestId("run-row")).toHaveLength(1);
  });

  it("shows an empty state with Clear filters when a filter is set", async () => {
    render(<ActionsScreen />);
    await screen.findByText("No workflow runs");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(listRuns).toHaveBeenLastCalledWith("/r", { page: 1 }));
    expect(useActionsStore.getState().filters.status).toBe("");
  });

  it("shows an error state and retries", async () => {
    listRuns.mockRejectedValueOnce("gh: HTTP 403 Forbidden");
    render(<ActionsScreen />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    listRuns.mockResolvedValue({ runs: [run(1)], hasMore: false });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByTestId("run-row")).toHaveLength(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("shows the GitHub-unavailable state and does not load runs", async () => {
    useGithubStore.setState({ status: { available: false, owner: null, repo: null, reason: "no remote" } } as never);
    render(<ActionsScreen />);
    await flush();
    expect(screen.getByText(describeGithubUnavailable("no remote", false).title)).toBeInTheDocument();
    expect(listRuns).not.toHaveBeenCalled();
  });

  it("shows No repository selected without an active repo", async () => {
    useWorkspaceStore.setState({ activeRepoId: null } as never);
    render(<ActionsScreen />);
    expect(screen.getByText("No repository selected")).toBeInTheDocument();
    expect(listRuns).not.toHaveBeenCalled();
  });

  it("Load more appends the next page", async () => {
    listRuns.mockResolvedValueOnce({ runs: [run(1)], hasMore: true });
    render(<ActionsScreen />);
    await screen.findAllByTestId("run-row");
    listRuns.mockResolvedValueOnce({ runs: [run(2)], hasMore: false });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByTestId("run-row")).toHaveLength(2));
    expect(listRuns).toHaveBeenLastCalledWith("/r", { page: 2 });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("clicking a row (or pressing Enter) opens the run detail; back returns to the list", async () => {
    listRuns.mockResolvedValue({ runs: [run(1)], hasMore: false });
    render(<ActionsScreen />);
    fireEvent.click((await screen.findAllByTestId("run-row"))[0]);
    expect(useActionsStore.getState().selectedRunId).toBe(1);
    expect(await screen.findByRole("button", { name: /Show commit/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
    expect(await screen.findAllByTestId("run-row")).toHaveLength(1);
    fireEvent.keyDown(screen.getAllByTestId("run-row")[0], { key: "Enter" });
    expect(useActionsStore.getState().selectedRunId).toBe(1);
    await flush();
  });

  describe("polling", () => {
    it("refreshes every 15s while a run is running", async () => {
      vi.useFakeTimers();
      listRuns.mockResolvedValue({ runs: [run(1, { status: "in_progress", conclusion: null })], hasMore: false });
      const { unmount } = render(<ActionsScreen />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(listRuns).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(ACTIONS_POLL_MS); });
      expect(listRuns).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(ACTIONS_POLL_MS); });
      expect(listRuns).toHaveBeenCalledTimes(3);
      unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(ACTIONS_POLL_MS * 2); });
      expect(listRuns).toHaveBeenCalledTimes(3);
    });

    it("stops polling once nothing is running", async () => {
      vi.useFakeTimers();
      listRuns.mockResolvedValueOnce({ runs: [run(1, { status: "in_progress", conclusion: null })], hasMore: false });
      listRuns.mockResolvedValue({ runs: [run(1)], hasMore: false });
      render(<ActionsScreen />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(ACTIONS_POLL_MS); });
      expect(listRuns).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(ACTIONS_POLL_MS * 3); });
      expect(listRuns).toHaveBeenCalledTimes(2);
    });

    it("does not poll when no run is running", async () => {
      vi.useFakeTimers();
      listRuns.mockResolvedValue({ runs: [run(1)], hasMore: false });
      render(<ActionsScreen />);
      await act(async () => { await vi.advanceTimersByTimeAsync(ACTIONS_POLL_MS * 3); });
      expect(listRuns).toHaveBeenCalledTimes(1);
    });
  });
});
