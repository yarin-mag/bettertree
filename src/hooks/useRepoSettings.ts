import { useEffect } from "react";
import { DEFAULT_REPO_SETTINGS, type RepoSettings } from "../lib/repoSettings";
import { useRepoSettingsStore } from "../store/repoSettingsStore";

/** The repo's stored settings, or the defaults until they load (or without a repo). */
export function useRepoSettings(path: string | null | undefined): RepoSettings {
  const stored = useRepoSettingsStore((s) => (path ? s.byPath[path] : undefined));
  useEffect(() => {
    if (path) void useRepoSettingsStore.getState().load(path);
  }, [path]);
  return stored ?? DEFAULT_REPO_SETTINGS;
}
