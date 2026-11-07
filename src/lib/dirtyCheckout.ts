import { useWorkspaceStore } from "../store/workspaceStore";
import { useDirtyCheckoutStore, type DirtyCheckoutTarget } from "../store/dirtyCheckoutStore";
import { toast } from "../store/toastStore";
import { invokeStashChanges, invokeStashPop, invokeDiscardChanges, invokeAddWorktree } from "./tauri";

interface DirtyError {
  code: "dirty_workdir";
  message: string;
}

/** The backend sends `{ code: "dirty_workdir", message }` when changes block a checkout. */
export function isDirtyError(e: unknown): e is DirtyError {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "dirty_workdir";
}

export function errorMessage(e: unknown): string {
  if (isDirtyError(e)) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Opens the dirty-checkout dialog for a blocked checkout. Returns false for any other error. */
export function openIfDirty(e: unknown, target: Omit<DirtyCheckoutTarget, "reason">): boolean {
  if (!isDirtyError(e)) return false;
  useDirtyCheckoutStore.getState().open({ ...target, reason: e.message });
  return true;
}

/** `<worktreeDir or repo parent>/<repo-name>-<branch>`, with slashes in the branch turned into dashes. */
export function defaultWorktreePath(
  repoPath: string,
  branchName: string,
  isRemote = false,
  worktreeDir = ""
): string {
  const repo = repoPath.replace(/\/+$/, "");
  const local = isRemote ? branchName.split("/").slice(1).join("/") || branchName : branchName;
  const dir = worktreeDir.trim().replace(/\/+$/, "");
  const prefix = dir ? `${dir}/${repo.split("/").pop()}` : repo;
  return `${prefix}-${local.replace(/\//g, "-")}`;
}

function activeRepoPath(): string {
  const { repos, activeRepoId } = useWorkspaceStore.getState();
  const path = repos.find((r) => r.id === activeRepoId)?.path;
  if (!path) throw new Error("No active repository");
  return path;
}

function checkout(path: string, t: DirtyCheckoutTarget): Promise<void> {
  const ws = useWorkspaceStore.getState();
  return t.kind === "tag" ? ws.checkoutTag(path, t.name) : ws.switchBranch(path, t.name, t.isRemote);
}

// The three actions below throw on failure so the dialog can show the reason.

/** Stashes the changes, switches, and puts the changes back if the switch fails. */
export async function stashAndCheckout(t: DirtyCheckoutTarget): Promise<void> {
  const path = activeRepoPath();
  await invokeStashChanges(path, `bettertree: auto-stash before switching to ${t.name}`);
  try {
    await checkout(path, t);
  } catch (e) {
    await invokeStashPop(path).catch(() => {});
    throw e;
  }
  toast.success(`Stashed changes and checked out ${t.name}`);
}

export async function discardAndCheckout(t: DirtyCheckoutTarget): Promise<void> {
  const path = activeRepoPath();
  await invokeDiscardChanges(path);
  await checkout(path, t);
  toast.success(`Discarded changes and checked out ${t.name}`);
}

export async function createWorktreeFor(t: DirtyCheckoutTarget, worktreePath: string): Promise<void> {
  await invokeAddWorktree(activeRepoPath(), t.name, t.isRemote, worktreePath);
  toast.success(`Created worktree for ${t.name} at ${worktreePath}`);
}
