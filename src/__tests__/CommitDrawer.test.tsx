import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import CommitDrawer from "../components/CommitDrawer";

vi.mock("../lib/tauri", () => ({
  invokeGetCommitDiff: vi.fn(),
}));

vi.mock("../lib/highlight", () => ({
  highlightLine: vi.fn().mockResolvedValue('<pre class="shiki"><code><span class="line"></span></code></pre>'),
}));

import * as tauriLib from "../lib/tauri";

describe("CommitDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useUiStore.setState({ selectedCommitOid: null });
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
});
