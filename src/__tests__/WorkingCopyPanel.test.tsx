import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkingCopyStore } from "../store/workingCopyStore";
import WorkingCopyPanel from "../components/WorkingCopyPanel";

vi.mock("../lib/tauri", () => ({
  invokeGetStatus: vi.fn(),
  invokeStageFile: vi.fn(),
  invokeUnstageFile: vi.fn(),
  invokeCommitChanges: vi.fn(),
}));

import * as tauriLib from "../lib/tauri";

describe("WorkingCopyPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (tauriLib.invokeGetStatus as any).mockResolvedValue([{ path: "a.txt", state: "ModifiedUnstaged" }]);
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useWorkingCopyStore.setState({
      status: [{ path: "a.txt", state: "ModifiedUnstaged" }],
      commitMessage: "",
    });
  });

  it("stages a file when its Stage button is clicked", async () => {
    (tauriLib.invokeStageFile as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetStatus as any).mockResolvedValue([{ path: "a.txt", state: "ModifiedStaged" }]);

    render(<WorkingCopyPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Stage" }));

    await waitFor(() => {
      expect(tauriLib.invokeStageFile).toHaveBeenCalledWith("/tmp/a", "a.txt");
    });
  });

  it("commits with the typed message and disables the button when message is empty", () => {
    render(<WorkingCopyPanel />);
    const commitButton = screen.getByRole("button", { name: "Commit" });
    expect(commitButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Commit message"), { target: { value: "fix bug" } });
    expect(commitButton).not.toBeDisabled();
  });
});
