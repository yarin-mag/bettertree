import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { useUiStore } from "../store/uiStore";
import CommitDrawer from "../components/CommitDrawer";

vi.mock("../lib/tauri", () => ({
  invokeGetCommitDiff: vi.fn(),
}));

vi.mock("../lib/highlight", () => ({
  highlightLine: vi.fn().mockResolvedValue('<pre class="shiki"><code><span class="line"></span></code></pre>'),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

import * as tauriLib from "../lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";

describe("CommitDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useUiStore.setState({ selectedCommitOid: null });
    useGithubStore.setState({ status: null });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("renders nothing when no commit is selected", () => {
    render(<CommitDrawer />);
    expect(screen.queryByText("fix bug")).not.toBeInTheDocument();
  });

  it("loads and renders commit metadata and diff when a commit is selected", async () => {
    (tauriLib.invokeGetCommitDiff as any).mockResolvedValue({
      oid: "c2",
      author: "Test User",
      email: "test@example.com",
      timestamp: 200,
      message: "fix bug",
      parents: ["c1"],
      files: [
        {
          path: "a.txt",
          status: "modified",
          patch: "-one\n+two\n",
          oldContent: "one",
          newContent: "two",
          insertions: 1,
          deletions: 1,
        },
      ],
    });
    useUiStore.setState({ selectedCommitOid: "c2" });

    render(<CommitDrawer />);

    await waitFor(() => {
      expect(screen.getByText("fix bug")).toBeInTheDocument();
    });
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(tauriLib.invokeGetCommitDiff).toHaveBeenCalledWith("/tmp/a", "c2");
  });

  const mockDetail = (overrides = {}) => ({
    oid: "c2",
    author: "Test User",
    email: "test@example.com",
    timestamp: 200,
    message: "fix bug",
    parents: ["c1"],
    files: [],
    ...overrides,
  });

  it("copies the full SHA to the clipboard", async () => {
    (tauriLib.invokeGetCommitDiff as any).mockResolvedValue(mockDetail());
    useUiStore.setState({ selectedCommitOid: "c2" });
    render(<CommitDrawer />);
    await waitFor(() => expect(screen.getByText("fix bug")).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("Copy full SHA"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("c2");
  });

  it("shows a GitHub link only when github status is available", async () => {
    (tauriLib.invokeGetCommitDiff as any).mockResolvedValue(mockDetail());
    useUiStore.setState({ selectedCommitOid: "c2" });
    useGithubStore.setState({ status: { available: true, owner: "acme", repo: "widgets", reason: null } });
    render(<CommitDrawer />);
    await waitFor(() => expect(screen.getByText("fix bug")).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("Open commit on GitHub"));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/widgets/commit/c2");
  });

  it("hides the GitHub link when github status is unavailable", async () => {
    (tauriLib.invokeGetCommitDiff as any).mockResolvedValue(mockDetail());
    useUiStore.setState({ selectedCommitOid: "c2" });
    render(<CommitDrawer />);
    await waitFor(() => expect(screen.getByText("fix bug")).toBeInTheDocument());

    expect(screen.queryByTitle("Open commit on GitHub")).not.toBeInTheDocument();
  });

  it("clicking a parent SHA selects that commit", async () => {
    (tauriLib.invokeGetCommitDiff as any).mockResolvedValue(mockDetail());
    const selectCommit = vi.fn();
    useUiStore.setState({ selectedCommitOid: "c2", selectCommit });
    render(<CommitDrawer />);
    await waitFor(() => expect(screen.getByText("fix bug")).toBeInTheDocument());

    fireEvent.click(screen.getByText("c1"));
    expect(selectCommit).toHaveBeenCalledWith("c1");
  });

  it("navigates to the next/previous commit in the graph", async () => {
    (tauriLib.invokeGetCommitDiff as any).mockImplementation((_path: string, oid: string) =>
      Promise.resolve(mockDetail({ oid }))
    );
    useWorkspaceStore.setState({
      commits: [
        { oid: "c2", summary: "second", author: "a", timestamp: 2, lane: 0, edges: [], activeLanes: [] },
        { oid: "c1", summary: "first", author: "a", timestamp: 1, lane: 0, edges: [], activeLanes: [] },
      ],
    });
    const selectCommit = vi.fn();
    useUiStore.setState({ selectedCommitOid: "c2", selectCommit });
    render(<CommitDrawer />);
    await waitFor(() => expect(screen.getByText("fix bug")).toBeInTheDocument());

    expect(screen.getByLabelText("Newer commit")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Older commit"));
    expect(selectCommit).toHaveBeenCalledWith("c1");
  });
});
