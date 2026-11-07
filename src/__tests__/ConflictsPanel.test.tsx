import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useConflictStore } from "../store/conflictStore";
import ConflictsPanel from "../components/ConflictsPanel";

vi.mock("../lib/tauri", () => ({
  invokeListConflictedFiles: vi.fn(),
  invokeOpenInEditor: vi.fn().mockResolvedValue(undefined),
  invokeAbortMerge: vi.fn().mockResolvedValue(undefined),
  invokeMarkResolved: vi.fn().mockResolvedValue(undefined),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
}));

import * as tauriLib from "../lib/tauri";

const conflicted = {
  files: [{ path: "a.txt", status: "both modified" }],
  inProgress: true,
  operation: "merge" as const,
};

describe("ConflictsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (tauriLib.invokeListConflictedFiles as any).mockResolvedValue(conflicted);
    useConflictStore.setState({ ...conflicted, panelOpen: true });
  });

  it("lists files and opens one in the editor", () => {
    render(<ConflictsPanel repoPath="/tmp/a" />);
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.getByText("both modified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open in editor/ }));
    expect(tauriLib.invokeOpenInEditor).toHaveBeenCalledWith("/tmp/a", "a.txt");
  });

  it("marks a file resolved, then shows the empty state once the list is empty", async () => {
    (tauriLib.invokeListConflictedFiles as any).mockResolvedValue({ ...conflicted, files: [] });
    render(<ConflictsPanel repoPath="/tmp/a" />);
    fireEvent.click(screen.getByRole("button", { name: /Mark resolved/ }));
    expect(tauriLib.invokeMarkResolved).toHaveBeenCalledWith("/tmp/a", "a.txt");
    expect(await screen.findByText("All conflicts resolved")).toBeInTheDocument();
  });

  it("requires inline confirmation before aborting the merge", async () => {
    render(<ConflictsPanel repoPath="/tmp/a" />);
    fireEvent.click(screen.getByRole("button", { name: /Abort merge/ }));
    expect(tauriLib.invokeAbortMerge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, abort" }));
    await waitFor(() => expect(tauriLib.invokeAbortMerge).toHaveBeenCalledWith("/tmp/a"));
  });

  it("closes on Escape", () => {
    render(<ConflictsPanel repoPath="/tmp/a" />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useConflictStore.getState().panelOpen).toBe(false);
  });
});
