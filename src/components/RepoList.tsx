import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { X, History, FolderGit2 } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useRecentReposStore } from "../store/recentReposStore";
import { toast } from "../store/toastStore";
import EmptyState from "./EmptyState";
import { useContextMenu } from "./ContextMenu";
import { useSettingsModalStore } from "../store/settingsModalStore";
import { useOpenTargetsStore } from "../store/openTargetsStore";
import { buildOpenInItems } from "../lib/openIn";

export default function RepoList() {
  const { repos, activeRepoId, loadRepos, addRepo, removeRepo, setActiveRepo } = useWorkspaceStore();
  const { recentlyClosed, removeClosed } = useRecentReposStore();
  const [showRecent, setShowRecent] = useState(false);
  const { openMenu, menu } = useContextMenu();

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  // Detect where each repo can be opened, so the right-click menu is ready when it opens.
  const openTargets = useOpenTargetsStore((s) => s.byPath);
  useEffect(() => {
    for (const r of repos) void useOpenTargetsStore.getState().load(r.path);
  }, [repos]);

  const handleAdd = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      try {
        const repo = await addRepo(selected);
        toast.success(`Added ${repo.name}`);
      } catch (e) {
        toast.error(`Couldn't add repository: ${e}`);
      }
    }
  };

  const handleReopen = async (path: string) => {
    try {
      const repo = await addRepo(path);
      removeClosed(path);
      setShowRecent(false);
      toast.success(`Reopened ${repo.name}`);
    } catch (e) {
      toast.error(`Couldn't reopen repository: ${e}`);
    }
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex items-center gap-1">
        <button
          className="flex-1 text-sm text-left px-2 py-1 rounded text-text-muted hover:bg-hover hover:text-text-primary transition-colors duration-100 press-scale"
          onClick={handleAdd}
        >
          + Add repo
        </button>
        {recentlyClosed.length > 0 && (
          <button
            className="p-1 rounded text-text-muted hover:bg-hover hover:text-text-primary transition-colors duration-100 press-scale"
            title="Open recent"
            onClick={() => setShowRecent((prev) => !prev)}
          >
            <History size={14} />
          </button>
        )}
      </div>
      {showRecent && recentlyClosed.length > 0 && (
        <div className="flex flex-col gap-0.5 mb-1 border border-border-subtle rounded p-1 animate-pop-in">
          <div className="text-xs uppercase text-text-muted px-1">Recently closed</div>
          {recentlyClosed.map((r) => (
            <button
              key={r.path}
              className="text-sm text-left px-2 py-1 rounded text-text-primary hover:bg-hover transition-colors duration-100 truncate"
              title={r.path}
              onClick={() => handleReopen(r.path)}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
      {repos.length === 0 && (
        <EmptyState
          compact
          icon={<FolderGit2 size={14} />}
          title="No repositories yet"
          hint="Add a local git repository to get started."
          action={{ label: "Add repository", onClick: handleAdd }}
        />
      )}
      {repos.map((r) => (
        <div
          key={r.id}
          className="flex items-center group"
          onContextMenu={(e) =>
            openMenu(e, [
              { label: "Repo settings…", onSelect: () => useSettingsModalStore.getState().open(r.path) },
              ...buildOpenInItems(r.path, openTargets[r.path] ?? []).map((item, i) => ({
                ...item,
                separatorBefore: i === 0,
              })),
            ])
          }
        >
          <button
            className={`flex-1 text-sm text-left px-2 py-1 rounded truncate transition-colors duration-100 ${
              r.id === activeRepoId ? "bg-accent-soft text-accent font-medium" : "text-text-primary hover:bg-hover"
            }`}
            onClick={() => setActiveRepo(r.id)}
          >
            {r.name}
          </button>
          <button
            className="p-1 rounded text-text-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-danger transition-colors duration-100 press-scale"
            title="Close repo"
            onClick={(e) => {
              e.stopPropagation();
              removeRepo(r.id).then(
                () => toast.info(`Closed ${r.name}`),
                (err) => toast.error(`Couldn't close ${r.name}: ${err}`),
              );
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {menu}
    </div>
  );
}
