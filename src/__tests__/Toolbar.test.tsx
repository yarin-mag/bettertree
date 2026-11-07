import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useViewStore } from "../store/viewStore";
import { useGithubStore } from "../store/githubStore";
import { useConflictStore } from "../store/conflictStore";
import { useToastStore } from "../store/toastStore";
import Toolbar from "../components/Toolbar";
import { useOpenTargetsStore } from "../store/openTargetsStore";

// setActiveRepo (called by Toolbar's refresh-after-pull/fetch path) also
// calls invokeEnsureSearchIndex internally — it must be mocked here too,
// or that fire-and-forget call throws "not a function" inside the test.
vi.mock("../lib/tauri", () => ({
  invokeFetchRemote: vi.fn(),
  invokePullRemote: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
  invokeListConflictedFiles: vi.fn(),
  invokeOpenInEditor: vi.fn(),
  invokeAbortMerge: vi.fn(),
  invokeMarkResolved: vi.fn(),
  invokeGetAheadBehind: vi.fn(),
  invokeListOpenTargets: vi.fn(),
  invokeOpenIn: vi.fn(),
}));
vi.mock("../lib/branchActions", () => ({ copyWithToast: vi.fn(), checkoutBranch: vi.fn() }));

import * as tauriLib from "../lib/tauri";
import { copyWithToast } from "../lib/branchActions";

describe("Toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (tauriLib.invokeListConflictedFiles as any).mockResolvedValue({ files: [], inProgress: false, operation: null });
    (tauriLib.invokeGetAheadBehind as any).mockResolvedValue(null);
    useConflictStore.getState().reset();
    useToastStore.setState({ toasts: [] });
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [],
      tags: [],
      commits: [],
    });
  });

  it("refreshes branches after a successful pull", async () => {
    (tauriLib.invokePullRemote as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetBranches as any).mockResolvedValue({ branches: [], headDetached: false, headOid: null });
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));

    await waitFor(() => {
      expect(tauriLib.invokeGetBranches).toHaveBeenCalledWith("/tmp/a");
    });
  });

  it("shows the active repo name, and a result count only in Pull Requests view", async () => {
    useViewStore.setState({ activeView: "repo" });
    useGithubStore.setState({ pullRequests: [] });
    const { rerender } = render(<Toolbar />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText(/results?$/)).not.toBeInTheDocument();

    useViewStore.setState({ activeView: "pulls" });
    useGithubStore.setState({ pullRequests: [{ number: 1 }, { number: 2 }] as any });
    rerender(<Toolbar />);
    expect(screen.getByText("2 results")).toBeInTheDocument();
    // let the ahead/behind lookup settle inside act
    await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalled());
    await act(async () => {});
  });

  it("shows an N conflicts button on activation and opens the panel", async () => {
    (tauriLib.invokeListConflictedFiles as any).mockResolvedValue({
      files: [
        { path: "a.txt", status: "both modified" },
        { path: "b.txt", status: "both added" },
      ],
      inProgress: true,
      operation: "merge",
    });
    render(<Toolbar />);
    fireEvent.click(await screen.findByRole("button", { name: /2 conflicts/ }));
    expect(screen.getByRole("dialog", { name: "Merge conflicts" })).toBeInTheDocument();
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.getByText("b.txt")).toBeInTheDocument();
  });

  it("turns a conflicting pull into a toast with a View conflicts action, not an error banner", async () => {
    (tauriLib.invokePullRemote as any).mockRejectedValue("Pull produced merge conflicts");
    (tauriLib.invokeGetBranches as any).mockResolvedValue({ branches: [], headDetached: false, headOid: null });
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.message === "Pull produced merge conflicts")).toBe(true);
    });
    expect(screen.queryByText("Pull produced merge conflicts")).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts[0].action?.label).toBe("View conflicts");
  });

  describe("current branch chip", () => {
    const head = { name: "feature/x", isRemote: false, isHead: true, targetOid: "abcdef1234567" };

    it("shows the current local branch next to the repo name", async () => {
      useWorkspaceStore.setState({
        branches: [{ name: "main", isRemote: false, isHead: false, targetOid: "z" }, { ...head }, { name: "origin/feature/x", isRemote: true, isHead: true, targetOid: "q" }],
        headDetached: false,
        headOid: head.targetOid,
      });
      render(<Toolbar />);
      expect(screen.getByTestId("branch-chip")).toHaveTextContent("feature/x");
      await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalled());
    });

    it("shows detached @ short oid when HEAD is detached", async () => {
      useWorkspaceStore.setState({ branches: [], tags: [], headDetached: true, headOid: "1234567890abcdef" });
      render(<Toolbar />);
      expect(screen.getByTestId("branch-chip")).toHaveTextContent("detached @ 1234567");
      await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalled());
    });

    it("shows detached @ tag name when HEAD is on a tag", async () => {
      useWorkspaceStore.setState({ branches: [], tags: [{ name: "v1.0", targetOid: "1234567890abcdef" }], headDetached: true, headOid: "1234567890abcdef" });
      render(<Toolbar />);
      expect(screen.getByTestId("branch-chip")).toHaveTextContent("detached @ v1.0");
      await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalled());
    });

    it("renders no chip without HEAD info", async () => {
      useWorkspaceStore.setState({ branches: [], headDetached: false, headOid: null });
      render(<Toolbar />);
      expect(screen.queryByTestId("branch-chip")).not.toBeInTheDocument();
      await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalled());
    });

    it("renders no chip without an active repo", () => {
      useWorkspaceStore.setState({ activeRepoId: null, branches: [{ ...head }], headOid: head.targetOid });
      render(<Toolbar />);
      expect(screen.queryByTestId("branch-chip")).not.toBeInTheDocument();
    });

    it("opens a branch search when the chip is clicked, and can still copy the name from there", async () => {
      useWorkspaceStore.setState({ branches: [{ ...head }], headDetached: false, headOid: head.targetOid });
      render(<Toolbar />);
      fireEvent.click(screen.getByTestId("branch-chip"));
      expect(screen.getByPlaceholderText("Jump to branch...")).toHaveFocus();
      fireEvent.click(screen.getByRole("button", { name: "Copy branch name" }));
      expect(copyWithToast).toHaveBeenCalledWith("feature/x", "branch name");
      await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalled());
    });

    it("the detached chip opens the branch search too", async () => {
      useWorkspaceStore.setState({ branches: [{ name: "main", isRemote: false, isHead: false, targetOid: "z" }], tags: [], headDetached: true, headOid: "1234567890abcdef" });
      render(<Toolbar />);
      fireEvent.click(screen.getByTestId("branch-chip"));
      expect(screen.getByPlaceholderText("Jump to branch...")).toBeInTheDocument();
      await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalled());
    });

    it("shows ahead/behind counts, hiding zeros, with a tooltip", async () => {
      useWorkspaceStore.setState({ branches: [{ ...head }], headDetached: false, headOid: head.targetOid });
      (tauriLib.invokeGetAheadBehind as any).mockResolvedValue({ ahead: 3, behind: 0, upstream: "origin/feature/x" });
      render(<Toolbar />);
      const el = await screen.findByTestId("ahead-behind");
      expect(el).toHaveTextContent("↑3");
      expect(el).not.toHaveTextContent("↓");
      expect(el).toHaveAttribute("title", "3 ahead / 0 behind origin/feature/x");
    });

    it("shows both counts when diverged", async () => {
      useWorkspaceStore.setState({ branches: [{ ...head }], headDetached: false, headOid: head.targetOid });
      (tauriLib.invokeGetAheadBehind as any).mockResolvedValue({ ahead: 1, behind: 2, upstream: "origin/x" });
      render(<Toolbar />);
      expect(await screen.findByTestId("ahead-behind")).toHaveTextContent("↑1 ↓2");
    });

    it("hides ahead/behind when both are 0 or the lookup fails", async () => {
      useWorkspaceStore.setState({ branches: [{ ...head }], headDetached: false, headOid: head.targetOid });
      (tauriLib.invokeGetAheadBehind as any).mockResolvedValue({ ahead: 0, behind: 0, upstream: "origin/x" });
      const { unmount } = render(<Toolbar />);
      await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalled());
      expect(screen.queryByTestId("ahead-behind")).not.toBeInTheDocument();
      unmount();
      (tauriLib.invokeGetAheadBehind as any).mockRejectedValue(new Error("x"));
      render(<Toolbar />);
      await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId("ahead-behind")).not.toBeInTheDocument();
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  describe("Open in…", () => {
    beforeEach(() => {
      (tauriLib.invokeListOpenTargets as any).mockResolvedValue([{ id: "vscode", label: "VS Code" }, { id: "finder", label: "Finder" }]);
      useOpenTargetsStore.setState({ byPath: { "/tmp/a": [{ id: "vscode", label: "VS Code" }, { id: "finder", label: "Finder" }] } });
    });

    it("has a button that lists where to open the repo", async () => {
      render(<Toolbar />);
      fireEvent.click(screen.getByRole("button", { name: "Open in…" }));
      expect(screen.getAllByRole("menuitem").map((e) => e.textContent)).toEqual(["Open in VS Code", "Reveal in Finder", "Copy path"]);
      await waitFor(() => expect(tauriLib.invokeGetAheadBehind).toHaveBeenCalled());
    });

    it("is hidden without an active repo", () => {
      useWorkspaceStore.setState({ activeRepoId: null });
      render(<Toolbar />);
      expect(screen.queryByRole("button", { name: "Open in…" })).not.toBeInTheDocument();
    });
  });
});
