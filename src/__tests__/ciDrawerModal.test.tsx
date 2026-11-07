import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { useUiStore } from "../store/uiStore";
import { useCiChecksStore } from "../store/ciChecksStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { useCiStatusStore } from "../store/ciStatusStore";
import CommitDrawer from "../components/CommitDrawer";

vi.mock("../lib/tauri", () => ({
  invokeGetCommitDiff: vi.fn().mockResolvedValue({
    oid: "c2", author: "T", email: "t@e.com", timestamp: 200, message: "fix bug", parents: [],
    files: [{ path: "zed.txt", status: "modified", patch: "-one\n+two\n", oldContent: "one", newContent: "two", insertions: 1, deletions: 1 }],
  }),
  invokeCiCommitChecks: vi.fn().mockResolvedValue({
    oid: "c2",
    runs: [{
      runId: 1, workflowId: 1, workflowName: "CI", status: "completed", conclusion: "success", url: "https://x",
      startedAt: null, updatedAt: null, jobs: [],
    }],
    other: [],
  }),
  invokeCiStatusForCommits: vi.fn().mockResolvedValue([]),
  invokeCiRerun: vi.fn(), invokeCiCancel: vi.fn(),
}));
vi.mock("../lib/highlight", () => ({ highlightLine: vi.fn().mockResolvedValue("") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("CommitDrawer CI wiring", () => {
  beforeEach(() => {
    localStorage.clear();
    useCiStatusStore.setState({ byOid: {} } as any);
    useCiPrefsStore.setState({ prefs: {} } as any);
    useCiChecksStore.setState({ repoPath: null, oid: null, checks: null, loading: false, error: null } as any);
    useWorkspaceStore.setState({ repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }], activeRepoId: 1 } as any);
    useGithubStore.setState({ status: { available: true, owner: "o", repo: "r" } } as any);
    useUiStore.setState({ selectedCommitOid: "c2", drawerTab: "checks" } as any);
  });

  it("mounts exactly one ChecksPanel when the modal is open on the Checks tab", async () => {
    render(<CommitDrawer />);
    expect(await screen.findAllByTestId("workflow-title")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Open in modal"));
    expect(await screen.findAllByTestId("workflow-title")).toHaveLength(1);
  });

  it("keeps the inline Changes body mounted while the modal is open", async () => {
    useUiStore.setState({ drawerTab: "diff" } as any);
    render(<CommitDrawer />);
    const inline = (await screen.findAllByText("zed.txt"))[0];
    fireEvent.click(screen.getByLabelText("Open in modal"));
    await waitFor(() => expect(screen.getAllByText("zed.txt").length).toBeGreaterThan(1));
    expect(inline.isConnected).toBe(true);
  });

  it("renders no invalid DOM nesting for the Checks tab badge", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    useCiStatusStore.setState({ byOid: { c2: { oid: "c2", state: "failure", total: 1, failed: 1, pending: 0, byWorkflow: [] } } } as any);
    render(<CommitDrawer />);
    await screen.findAllByTestId("workflow-title");
    expect(screen.getAllByLabelText("CI failed").length).toBeGreaterThan(0);
    expect(err.mock.calls.filter((c) => String(c[0]).includes("validateDOMNesting") || String(c.join(" ")).includes("cannot be a descendant"))).toHaveLength(0);
    err.mockRestore();
  });

  it("'f' toggles favorites-only for the active repo only on the Checks tab", async () => {
    render(<CommitDrawer />);
    await screen.findAllByTestId("workflow-title");
    fireEvent.keyDown(window, { key: "f" });
    expect(useCiPrefsStore.getState().getPrefs("/tmp/a").favoritesOnly).toBe(true);
    fireEvent.keyDown(window, { key: "f" });
    expect(useCiPrefsStore.getState().getPrefs("/tmp/a").favoritesOnly).toBe(false);
  });

  it("'c' switches to the Checks tab", async () => {
    useUiStore.setState({ drawerTab: "diff" } as any);
    render(<CommitDrawer />);
    await screen.findByText("fix bug");
    fireEvent.keyDown(window, { key: "c" });
    expect(useUiStore.getState().drawerTab).toBe("checks");
    await screen.findAllByTestId("workflow-title");
  });
});
