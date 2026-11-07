import { useWorkspaceStore } from "../store/workspaceStore";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { invokeLatestReleaseTag } from "./tauri";
import { headEnd } from "./releaseNotes";
import { toast } from "../store/toastStore";

/** Opens release notes from the newest matching release tag reachable from HEAD up to HEAD. */
export async function releaseNotesSinceLatestTag(): Promise<void> {
  const { repos, activeRepoId } = useWorkspaceStore.getState();
  const repo = repos.find((r) => r.id === activeRepoId);
  if (!repo) return;
  try {
    await useRepoSettingsStore.getState().load(repo.path);
    const pattern = useRepoSettingsStore.getState().byPath[repo.path]?.releaseTagPattern ?? "";
    const tag = await invokeLatestReleaseTag(repo.path, pattern);
    if (!tag) {
      toast.info(pattern ? `No tag matching "${pattern}" reachable from HEAD` : "No tags reachable from HEAD");
      return;
    }
    useReleaseNotesStore.getState().startRange({ oid: tag.oid, label: tag.name }, headEnd());
  } catch (e) {
    toast.error(`Couldn't find the latest release tag: ${e instanceof Error ? e.message : String(e)}`);
  }
}
