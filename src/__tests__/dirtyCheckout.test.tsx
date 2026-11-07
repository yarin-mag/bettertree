import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeStashChanges: vi.fn().mockResolvedValue(undefined),
  invokeStashPop: vi.fn().mockResolvedValue(undefined),
  invokeDiscardChanges: vi.fn().mockResolvedValue(undefined),
  invokeAddWorktree: vi.fn().mockResolvedValue(undefined),
}));

import * as tauri from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";
import { useDirtyCheckoutStore } from "../store/dirtyCheckoutStore";
import {
  isDirtyError,
  defaultWorktreePath,
  stashAndCheckout,
  discardAndCheckout,
  createWorktreeFor,
} from "../lib/dirtyCheckout";
import { checkoutBranch } from "../lib/branchActions";
import BranchTree from "../components/BranchTree";

const dirty = { code: "dirty_workdir", message: "cannot switch branches with uncommitted changes" };
const branchTarget = { kind: "branch" as const, name: "feature", isRemote: false, reason: dirty.message };
const tagTarget = { kind: "tag" as const, name: "v1.0", isRemote: false, reason: "cannot checkout a tag with uncommitted changes" };

describe("dirty checkout helpers", () => {
  const switchBranch = vi.fn();
  const checkoutTag = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    switchBranch.mockResolvedValue(undefined);
    checkoutTag.mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
    useDirtyCheckoutStore.getState().close();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/work/app", name: "app", pinned: false }],
      activeRepoId: 1,
      branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "a" }],
      tags: [{ name: "v1.0", targetOid: "a" }],
      switchBranch,
      checkoutTag,
    } as never);
  });

  it("recognises only the coded dirty error", () => {
    expect(isDirtyError(dirty)).toBe(true);
    expect(isDirtyError("cannot switch branches with uncommitted changes")).toBe(false);
    expect(isDirtyError(new Error("x"))).toBe(false);
    expect(isDirtyError(null)).toBe(false);
  });

  it("defaults the worktree path next to the repo, named repo-branch", () => {
    expect(defaultWorktreePath("/work/app", "feature/login")).toBe("/work/app-feature-login");
    expect(defaultWorktreePath("/work/app/", "origin/fix", true)).toBe("/work/app-fix");
  });

  it("puts the worktree in the configured folder, without doubled slashes", () => {
    expect(defaultWorktreePath("/work/app", "feature/login", false, "/wt")).toBe("/wt/app-feature-login");
    expect(defaultWorktreePath("/work/app/", "origin/fix", true, "/wt/")).toBe("/wt/app-fix");
    expect(defaultWorktreePath("/work/app", "x", false, "")).toBe("/work/app-x");
  });

  it("checkoutBranch opens the dialog on a dirty error instead of toasting", async () => {
    switchBranch.mockRejectedValue(dirty);

    await checkoutBranch("feature", false);

    expect(useDirtyCheckoutStore.getState().target).toEqual(branchTarget);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("checkoutBranch still toasts other failures", async () => {
    switchBranch.mockRejectedValue("boom");

    await checkoutBranch("feature", false);

    expect(useDirtyCheckoutStore.getState().target).toBeNull();
    expect(useToastStore.getState().toasts[0].message).toContain("boom");
  });

  it("stash then switch, with a message naming the target", async () => {
    await stashAndCheckout(branchTarget);

    expect(tauri.invokeStashChanges).toHaveBeenCalledWith(
      "/work/app",
      "bettertree: auto-stash before switching to feature"
    );
    expect(switchBranch).toHaveBeenCalledWith("/work/app", "feature", false);
    expect(tauri.invokeStashPop).not.toHaveBeenCalled();
  });

  it("pops the stash back and rethrows when the switch fails after stashing", async () => {
    switchBranch.mockRejectedValue("switch failed");

    await expect(stashAndCheckout(branchTarget)).rejects.toBe("switch failed");

    expect(tauri.invokeStashPop).toHaveBeenCalledWith("/work/app");
  });

  it("stashes before a tag checkout too", async () => {
    await stashAndCheckout(tagTarget);
    expect(checkoutTag).toHaveBeenCalledWith("/work/app", "v1.0");
  });

  it("discard then switch", async () => {
    await discardAndCheckout(branchTarget);

    expect(tauri.invokeDiscardChanges).toHaveBeenCalledWith("/work/app");
    expect(switchBranch).toHaveBeenCalledWith("/work/app", "feature", false);
  });

  it("creates a worktree without touching the current checkout", async () => {
    await createWorktreeFor(branchTarget, "/work/app-feature");

    expect(tauri.invokeAddWorktree).toHaveBeenCalledWith("/work/app", "feature", false, "/work/app-feature");
    expect(switchBranch).not.toHaveBeenCalled();
  });
});

describe("BranchTree dirty routing", () => {
  beforeEach(() => {
    useDirtyCheckoutStore.getState().close();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "a" }],
      tags: [{ name: "v1.0", targetOid: "a" }],
      switchBranch: vi.fn().mockResolvedValue(undefined),
      checkoutTag: vi.fn().mockRejectedValue({ code: "dirty_workdir", message: "cannot checkout a tag with uncommitted changes" }),
    } as never);
  });

  it("opens the dialog, not the inline error, when a tag checkout is blocked by changes", async () => {
    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("v1.0"));

    await waitFor(() =>
      expect(useDirtyCheckoutStore.getState().target).toEqual({
        kind: "tag",
        name: "v1.0",
        isRemote: false,
        reason: "cannot checkout a tag with uncommitted changes",
      })
    );
    expect(screen.queryByText(/uncommitted changes/)).toBeNull();
  });
});
