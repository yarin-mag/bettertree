import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeCreateBranch: vi.fn().mockResolvedValue(undefined),
  invokeCherryPickCommit: vi.fn().mockResolvedValue("newoid"),
}));

import * as tauri from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { useGraphFocusStore } from "../store/graphFocusStore";
import { useToastStore } from "../store/toastStore";
import { useUiStore } from "../store/uiStore";
import { useBranchActionStore } from "../store/branchActionStore";
import { jumpToCommit, cherryPickCommit } from "../lib/branchActions";
import CommitGraph from "../components/CommitGraph";
import CreateBranchDialog from "../components/CreateBranchDialog";

const commit = (oid: string) => ({
  oid,
  summary: `sum ${oid}`,
  author: "A",
  timestamp: 1,
  lane: 0,
  edges: [],
  activeLanes: [true],
});

describe("branch actions", () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useGraphFocusStore.setState({ requestedOid: null, nonce: 0 });
    useSearchStore.setState({ query: "" });
    useBranchActionStore.setState({ createBranchTarget: null });
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/r", name: "r", pinned: false }],
      activeRepoId: 1,
      commits: [commit("c1")],
      branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "c1" }],
      tags: [],
      hasMoreCommits: false,
      isLoadingMoreCommits: false,
      refreshActiveRepoData: refresh,
    });
  });

  it("jumpToCommit focuses a loaded commit", async () => {
    expect(await jumpToCommit("c1")).toBe(true);
    expect(useGraphFocusStore.getState().requestedOid).toBe("c1");
  });

  it("jumpToCommit pages in more commits until found", async () => {
    let page = 0;
    const loadMoreCommits = vi.fn(async () => {
      page++;
      useWorkspaceStore.setState({
        commits: [commit("c1"), ...(page >= 2 ? [commit("deep")] : [commit("x")])],
        hasMoreCommits: true,
      });
    });
    useWorkspaceStore.setState({ hasMoreCommits: true, loadMoreCommits });
    expect(await jumpToCommit("deep")).toBe(true);
    expect(loadMoreCommits).toHaveBeenCalledTimes(2);
  });

  it("jumpToCommit gives up once history is exhausted", async () => {
    const loadMoreCommits = vi.fn(async () => useWorkspaceStore.setState({ hasMoreCommits: false }));
    useWorkspaceStore.setState({ hasMoreCommits: true, loadMoreCommits });
    expect(await jumpToCommit("missing")).toBe(false);
    expect(useToastStore.getState().toasts.at(-1)?.kind).toBe("info");
  });

  it("jumpToCommit is capped when the commit never appears", async () => {
    const loadMoreCommits = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ hasMoreCommits: true, loadMoreCommits });
    expect(await jumpToCommit("missing")).toBe(false);
    expect(loadMoreCommits.mock.calls.length).toBeLessThanOrEqual(51);
  });

  it("cherryPickCommit refreshes and toasts success; toasts the error on failure", async () => {
    await cherryPickCommit("abcdef123");
    expect(tauri.invokeCherryPickCommit).toHaveBeenCalledWith("/r", "abcdef123");
    expect(refresh).toHaveBeenCalledWith("/r");
    expect(useToastStore.getState().toasts.at(-1)?.kind).toBe("success");

    vi.mocked(tauri.invokeCherryPickCommit).mockRejectedValueOnce("cherry-pick has conflicts");
    await cherryPickCommit("abcdef123");
    const last = useToastStore.getState().toasts.at(-1)!;
    expect(last.kind).toBe("error");
    expect(last.message).toContain("conflicts");
  });

  it("right-clicking a commit row offers Copy SHA, Create branch and Cherry-pick", async () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getByTestId("commit-row"));
    expect(screen.getByRole("menuitem", { name: "Copy SHA" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cherry-pick this commit" }));
    await waitFor(() => expect(tauri.invokeCherryPickCommit).toHaveBeenCalledWith("/r", "c1"));
    expect(useUiStore.getState().selectedCommitOid).not.toBe("c1");
  });

  it("Create branch here opens a dialog that creates the branch", async () => {
    render(
      <>
        <CommitGraph />
        <CreateBranchDialog />
      </>
    );
    fireEvent.contextMenu(screen.getByTestId("commit-row"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Create branch here/ }));
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: "topic" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(tauri.invokeCreateBranch).toHaveBeenCalledWith("/r", "topic", "c1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("clicking a branch badge requests focus on that branch's tip", async () => {
    render(<CommitGraph />);
    fireEvent.click(screen.getByText("main"));
    await waitFor(() => expect(useGraphFocusStore.getState().requestedOid).toBeNull());
  });

  it("virtualizes: a huge list renders only a window of rows", () => {
    useWorkspaceStore.setState({ commits: Array.from({ length: 5000 }, (_, i) => commit(`o${i}`)) });
    render(<CommitGraph />);
    const rows = screen.getAllByTestId("commit-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(200);
  });

  it("j/k move the active row", () => {
    useWorkspaceStore.setState({ commits: [commit("c1"), commit("c2")] });
    const selectCommit = vi.fn();
    useUiStore.setState({ selectCommit });
    render(<CommitGraph />);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(selectCommit).toHaveBeenCalledWith("c2");
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(selectCommit).toHaveBeenLastCalledWith("c1");
  });
});
