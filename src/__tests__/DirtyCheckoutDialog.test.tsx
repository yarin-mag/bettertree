import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../lib/dirtyCheckout", async (orig) => ({
  ...(await orig<typeof import("../lib/dirtyCheckout")>()),
  stashAndCheckout: vi.fn().mockResolvedValue(undefined),
  discardAndCheckout: vi.fn().mockResolvedValue(undefined),
  createWorktreeFor: vi.fn().mockResolvedValue(undefined),
}));

import * as dc from "../lib/dirtyCheckout";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useDirtyCheckoutStore } from "../store/dirtyCheckoutStore";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import DirtyCheckoutDialog from "../components/DirtyCheckoutDialog";

const branch = { kind: "branch" as const, name: "feature", isRemote: false, reason: "cannot switch branches with uncommitted changes" };
const tag = { kind: "tag" as const, name: "v1.0", isRemote: false, reason: "cannot checkout a tag with uncommitted changes" };

describe("DirtyCheckoutDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDirtyCheckoutStore.getState().close();
    useRepoSettingsStore.setState({ byPath: { "/work/app": DEFAULT_REPO_SETTINGS } });
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/work/app", name: "app", pinned: false }],
      activeRepoId: 1,
    } as never);
  });

  const open = (t: typeof branch | typeof tag) => {
    render(<DirtyCheckoutDialog />);
    act(() => useDirtyCheckoutStore.getState().open(t));
  };

  it("renders nothing until a checkout is blocked", () => {
    render(<DirtyCheckoutDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows why it appeared", () => {
    open(branch);
    expect(screen.getByText("cannot switch branches with uncommitted changes")).toBeTruthy();
  });

  it("stash and switch runs the action and closes", async () => {
    open(branch);
    fireEvent.click(screen.getByRole("button", { name: "Stash and switch" }));

    await waitFor(() => expect(dc.stashAndCheckout).toHaveBeenCalledWith(branch));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("discard needs a second click to confirm", async () => {
    open(branch);
    fireEvent.click(screen.getByRole("button", { name: "Discard changes and switch" }));
    expect(dc.discardAndCheckout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Click again to discard" }));

    await waitFor(() => expect(dc.discardAndCheckout).toHaveBeenCalledWith(branch));
  });

  it("creates a worktree at the editable default path", async () => {
    open(branch);
    const input = screen.getByLabelText("Worktree path") as HTMLInputElement;
    expect(input.value).toBe("/work/app-feature");
    fireEvent.change(input, { target: { value: "/elsewhere/feature" } });

    fireEvent.click(screen.getByRole("button", { name: "Open in new worktree" }));

    await waitFor(() => expect(dc.createWorktreeFor).toHaveBeenCalledWith(branch, "/elsewhere/feature"));
  });

  it("offers no worktree option for a tag", () => {
    open(tag);
    expect(screen.queryByRole("button", { name: "Open in new worktree" })).toBeNull();
    expect(screen.getByRole("button", { name: "Stash and switch" })).toBeTruthy();
  });

  it("keeps the dialog open and shows the failure inline", async () => {
    vi.mocked(dc.stashAndCheckout).mockRejectedValue("stash failed");
    open(branch);
    fireEvent.click(screen.getByRole("button", { name: "Stash and switch" }));

    expect(await screen.findByText("stash failed")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Cancel and Escape close without acting", async () => {
    open(branch);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => useDirtyCheckoutStore.getState().open(branch));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dc.stashAndCheckout).not.toHaveBeenCalled();
  });

  it("defaults the worktree path into the repo's configured worktree folder", () => {
    useRepoSettingsStore.setState({ byPath: { "/work/app": { ...DEFAULT_REPO_SETTINGS, worktreeDir: "/wt" } } });
    open(branch);
    expect((screen.getByLabelText("Worktree path") as HTMLInputElement).value).toBe("/wt/app-feature");
  });

  it("settings arriving late fill an untouched worktree path", () => {
    open(branch);
    expect((screen.getByLabelText("Worktree path") as HTMLInputElement).value).toBe("/work/app-feature");

    act(() => useRepoSettingsStore.setState({ byPath: { "/work/app": { ...DEFAULT_REPO_SETTINGS, worktreeDir: "/wt" } } }));

    expect((screen.getByLabelText("Worktree path") as HTMLInputElement).value).toBe("/wt/app-feature");
  });

  it("settings arriving late do not reset a typed path or the discard confirmation", () => {
    open(branch);
    fireEvent.change(screen.getByLabelText("Worktree path"), { target: { value: "/mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes and switch" }));

    act(() => useRepoSettingsStore.setState({ byPath: { "/work/app": { ...DEFAULT_REPO_SETTINGS, worktreeDir: "/wt" } } }));

    expect((screen.getByLabelText("Worktree path") as HTMLInputElement).value).toBe("/mine");
    expect(screen.getByRole("button", { name: "Click again to discard" })).toBeTruthy();
  });
});
