import { useWorkspaceStore } from "../store/workspaceStore";
import { useGraphFocusStore } from "../store/graphFocusStore";
import { toast } from "../store/toastStore";
import { invokeCreateBranch, invokeCherryPickCommit } from "./tauri";
import { copyText, copyRich } from "./clipboard";
import { errorMessage, openIfDirty } from "./dirtyCheckout";

// Upper bound on how many extra pages jumpToCommit will pull in while looking
// for a commit (each page is COMMIT_GRAPH_PAGE_SIZE commits).
export const JUMP_MAX_PAGES = 50;

function activeRepoPath(): string | null {
  const { repos, activeRepoId } = useWorkspaceStore.getState();
  return repos.find((r) => r.id === activeRepoId)?.path ?? null;
}

const message = errorMessage;

export async function copyWithToast(text: string, what: string): Promise<void> {
  if (await copyText(text)) toast.success(`Copied ${what}`);
  else toast.error(`Could not copy ${what}`);
}

export async function copyRichWithToast(html: string, text: string, what: string): Promise<boolean> {
  const ok = await copyRich(html, text);
  if (ok) toast.success(`Copied ${what}`);
  else toast.error(`Could not copy ${what}`);
  return ok;
}

export async function checkoutBranch(name: string, isRemote: boolean): Promise<void> {
  const path = activeRepoPath();
  if (!path) return;
  try {
    await useWorkspaceStore.getState().switchBranch(path, name, isRemote);
    toast.success(`Checked out ${name}`);
  } catch (e) {
    if (openIfDirty(e, { kind: "branch", name, isRemote })) return;
    toast.error(`Checkout failed: ${message(e)}`);
  }
}

/** Creates a branch at `oid`. Throws on failure so the dialog can show the reason. */
export async function createBranchAt(name: string, oid: string): Promise<void> {
  const path = activeRepoPath();
  if (!path) throw new Error("No active repository");
  await invokeCreateBranch(path, name, oid);
  await useWorkspaceStore.getState().refreshActiveRepoData(path);
  toast.success(`Created branch ${name}`);
}

export async function cherryPickCommit(oid: string): Promise<void> {
  const path = activeRepoPath();
  if (!path) return;
  try {
    await invokeCherryPickCommit(path, oid);
    await useWorkspaceStore.getState().refreshActiveRepoData(path);
    toast.success(`Cherry-picked ${oid.slice(0, 7)}`);
  } catch (e) {
    toast.error(`Cherry-pick failed: ${message(e)}`);
  }
}

/**
 * Asks the commit graph to highlight `oid`, first paging in more history if it
 * is not loaded yet. Gives up when history is exhausted or after JUMP_MAX_PAGES.
 */
export async function jumpToCommit(oid: string): Promise<boolean> {
  const ws = useWorkspaceStore;
  for (let page = 0; page <= JUMP_MAX_PAGES; page++) {
    const { commits, hasMoreCommits, isLoadingMoreCommits } = ws.getState();
    if (commits.some((c) => c.oid === oid)) {
      useGraphFocusStore.getState().focusCommit(oid);
      return true;
    }
    if (!hasMoreCommits) break;
    // A load already in flight makes loadMoreCommits a no-op; wait for it instead of spinning.
    if (isLoadingMoreCommits) {
      await new Promise((r) => setTimeout(r, 25));
      continue;
    }
    try {
      await ws.getState().loadMoreCommits();
    } catch {
      break;
    }
  }
  toast.info("That commit isn't in the loaded history");
  return false;
}
