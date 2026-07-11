import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeGetStatus: vi.fn(),
  invokeStageFile: vi.fn(),
  invokeUnstageFile: vi.fn(),
  invokeCommitChanges: vi.fn(),
}));

import { useWorkingCopyStore } from "../store/workingCopyStore";
import * as tauriLib from "../lib/tauri";

describe("workingCopyStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkingCopyStore.setState({ status: [], commitMessage: "" });
  });

  it("refreshStatus populates status from the backend", async () => {
    (tauriLib.invokeGetStatus as any).mockResolvedValue([{ path: "a.txt", state: "ModifiedUnstaged" }]);
    await useWorkingCopyStore.getState().refreshStatus("/tmp/a");
    expect(useWorkingCopyStore.getState().status).toHaveLength(1);
  });

  it("stage calls invokeStageFile then refreshes status", async () => {
    (tauriLib.invokeStageFile as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetStatus as any).mockResolvedValue([{ path: "a.txt", state: "ModifiedStaged" }]);

    await useWorkingCopyStore.getState().stage("/tmp/a", "a.txt");

    expect(tauriLib.invokeStageFile).toHaveBeenCalledWith("/tmp/a", "a.txt");
    expect(useWorkingCopyStore.getState().status[0].state).toBe("ModifiedStaged");
  });

  it("commit sends the current commit message, then clears it and refreshes status", async () => {
    useWorkingCopyStore.setState({ commitMessage: "fix bug" });
    (tauriLib.invokeCommitChanges as any).mockResolvedValue("deadbeef");
    (tauriLib.invokeGetStatus as any).mockResolvedValue([]);

    await useWorkingCopyStore.getState().commit("/tmp/a");

    expect(tauriLib.invokeCommitChanges).toHaveBeenCalledWith("/tmp/a", "fix bug");
    expect(useWorkingCopyStore.getState().commitMessage).toBe("");
    expect(useWorkingCopyStore.getState().status).toEqual([]);
  });
});
