import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import Toolbar from "../components/Toolbar";

// setActiveRepo (called by Toolbar's refresh-after-pull/fetch path) also
// calls invokeEnsureSearchIndex internally — it must be mocked here too,
// or that fire-and-forget call throws "not a function" inside the test.
vi.mock("../lib/tauri", () => ({
  invokeFetchRemote: vi.fn(),
  invokePullRemote: vi.fn(),
  invokePushRemote: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
}));

import * as tauriLib from "../lib/tauri";

describe("Toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [],
      tags: [],
      commits: [],
    });
  });

  it("shows an error banner when push fails", async () => {
    (tauriLib.invokePushRemote as any).mockRejectedValue("push rejected: pull first");

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Push" }));

    await waitFor(() => {
      expect(screen.getByText("push rejected: pull first")).toBeInTheDocument();
    });
  });

  it("refreshes branches after a successful pull", async () => {
    (tauriLib.invokePullRemote as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetBranches as any).mockResolvedValue([]);
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));

    await waitFor(() => {
      expect(tauriLib.invokeGetBranches).toHaveBeenCalledWith("/tmp/a");
    });
  });
});
