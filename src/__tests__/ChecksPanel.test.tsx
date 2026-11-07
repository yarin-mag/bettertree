import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ChecksPanel from "../components/ChecksPanel";
import { useCiChecksStore } from "../store/ciChecksStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { useWorkspaceStore } from "../store/workspaceStore";

vi.mock("../lib/tauri", () => ({
  invokeCiCommitChecks: vi.fn().mockResolvedValue({ oid: "a", runs: [], other: [] }),
  invokeCiRerun: vi.fn(), invokeCiCancel: vi.fn(), invokeCiStatusForCommits: vi.fn().mockResolvedValue([]),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const run = (id: number, wf: number, name: string, status: string, conclusion: string | null) => ({
  runId: id, workflowId: wf, workflowName: name, status, conclusion, url: "https://x", startedAt: null, updatedAt: null,
  jobs: [{ jobId: id * 10, name: "job", status, conclusion, startedAt: null, completedAt: null, url: "", steps: [] }],
});

function seed(runs: any[], other: any[] = []) {
  useCiChecksStore.setState({ repoPath: "/r", oid: "a", checks: { oid: "a", runs, other }, loading: false, error: null, load: vi.fn(), refresh: vi.fn() } as any);
}

describe("ChecksPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    useCiPrefsStore.setState({ prefs: {} } as any);
    useWorkspaceStore.setState({ repos: [{ id: 1, path: "/r", name: "r", pinned: false }], activeRepoId: 1 } as any);
  });

  it("shows failures first and a no-CI state when empty", () => {
    seed([run(1, 1, "Lint", "completed", "success"), run(2, 2, "Build", "completed", "failure")]);
    const { unmount } = render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    const titles = screen.getAllByTestId("workflow-title").map((n) => n.textContent);
    expect(titles).toEqual(["Build", "Lint"]);
    unmount();
    seed([]);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    expect(screen.getByText("No CI on this commit")).toBeInTheDocument();
  });

  it("renames a workflow, showing the original muted, and falls back when blanked", () => {
    seed([run(1, 1, "CI", "completed", "success")]);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Rename workflow"));
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Main pipeline" } });
    fireEvent.keyDown(screen.getByLabelText("Workflow name"), { key: "Enter" });
    expect(screen.getByTestId("workflow-title")).toHaveTextContent("Main pipeline");
    expect(screen.getByText("CI")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Rename workflow"));
    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "  " } });
    fireEvent.keyDown(screen.getByLabelText("Workflow name"), { key: "Enter" });
    expect(screen.getByTestId("workflow-title")).toHaveTextContent("CI");
  });

  it("favorites-only hides others behind a count, and hints when nothing is starred", () => {
    seed([run(1, 1, "CI", "completed", "success"), run(2, 2, "Deploy", "completed", "success")]);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Favorites only"));
    expect(screen.getByText("Star a workflow to see it here")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Favorites only")); // off
    fireEvent.click(screen.getAllByLabelText("Favorite workflow")[0]);
    fireEvent.click(screen.getByLabelText("Favorites only"));
    expect(screen.getAllByTestId("workflow-title")).toHaveLength(1);
    expect(screen.getByText("1 hidden")).toBeInTheDocument();
  });

  it("offers re-run for finished runs and cancel (with confirm) for running ones", async () => {
    const rerun = vi.fn().mockResolvedValue(undefined); const cancel = vi.fn().mockResolvedValue(undefined);
    seed([run(1, 1, "CI", "completed", "failure"), run(2, 2, "Deploy", "in_progress", null)]);
    useCiChecksStore.setState({ rerun, cancel } as any);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText("Re-run failed jobs")); });
    expect(rerun).toHaveBeenCalledWith(1, true);
    fireEvent.click(screen.getByText("Cancel"));
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByText("Confirm cancel")); });
    expect(cancel).toHaveBeenCalledWith(2);
  });

  it("shows the gh-unavailable empty state on a no-gh error", () => {
    useCiChecksStore.setState({ repoPath: "/r", oid: "a", checks: null, loading: false, error: { kind: "no-gh", message: "failed to run gh" }, load: vi.fn(), refresh: vi.fn() } as any);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    expect(screen.getByText("GitHub CLI not found")).toBeInTheDocument();
  });

  it("guards re-run against double clicks and disables buttons while pending", async () => {
    let resolve!: () => void;
    const rerun = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    seed([run(1, 1, "CI", "completed", "failure")]);
    useCiChecksStore.setState({ rerun } as any);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    const failedBtn = screen.getByRole("button", { name: "Re-run failed jobs" });
    fireEvent.click(failedBtn);
    fireEvent.click(failedBtn);
    expect(rerun).toHaveBeenCalledTimes(1);
    expect(failedBtn).toBeDisabled();
    expect(screen.getByRole("button", { name: "Re-run all" })).toBeDisabled();
    await act(async () => { resolve(); });
    expect(failedBtn).toBeEnabled();
    expect(screen.getByRole("button", { name: "Re-run all" })).toBeEnabled();
  });

  it("calls cancel once and disables the button while it is pending", async () => {
    let resolve!: () => void;
    const cancel = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    seed([run(2, 2, "Deploy", "in_progress", null)]);
    useCiChecksStore.setState({ cancel } as any);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(cancel).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("does not offer re-run failed jobs for a successful run", () => {
    seed([run(1, 1, "CI", "completed", "success")]);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    expect(screen.queryByText("Re-run failed jobs")).not.toBeInTheDocument();
    expect(screen.getByText("Re-run all")).toBeInTheDocument();
  });

  it("commits a rename once when Enter is followed by blur", () => {
    seed([run(1, 1, "CI", "completed", "success")]);
    const setName = vi.fn(useCiPrefsStore.getState().setName);
    useCiPrefsStore.setState({ setName } as any);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Rename workflow"));
    const input = screen.getByLabelText("Workflow name");
    fireEvent.change(input, { target: { value: "Main" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(setName).toHaveBeenCalledTimes(1);
    expect(useCiPrefsStore.getState().getPrefs("/r").names[1]).toBe("Main");
  });

  it("does not show another commit's checks while the oid changed (stale-oid guard)", () => {
    seed([run(1, 1, "StaleWorkflow", "completed", "success")]);
    render(<ChecksPanel oid="b" onOpenJob={vi.fn()} />);
    expect(screen.queryByText("StaleWorkflow")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workflow-title")).not.toBeInTheDocument();
  });

  it("does not show another commit's error", () => {
    useCiChecksStore.setState({ repoPath: "/r", oid: "a", checks: null, loading: false, error: { kind: "other", message: "boom-a" }, load: vi.fn(), refresh: vi.fn() } as any);
    render(<ChecksPanel oid="b" onOpenJob={vi.fn()} />);
    expect(screen.queryByText(/boom-a/)).not.toBeInTheDocument();
  });

  it("hints when favorites exist but none ran on this commit", () => {
    seed([run(1, 1, "CI", "completed", "success")]);
    useCiPrefsStore.getState().toggleFavorite("/r", 99);
    useCiPrefsStore.getState().setFavoritesOnly("/r", true);
    render(<ChecksPanel oid="a" onOpenJob={vi.fn()} />);
    expect(screen.getByText("None of your favorite workflows ran on this commit")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Show all"));
    expect(useCiPrefsStore.getState().getPrefs("/r").favoritesOnly).toBe(false);
  });
});
