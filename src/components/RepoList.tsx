import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../store/workspaceStore";

export default function RepoList() {
  const { repos, activeRepoId, loadRepos, addRepo, setActiveRepo } = useWorkspaceStore();

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const handleAdd = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await addRepo(selected);
    }
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <button
        className="text-sm text-left px-2 py-1 rounded text-text-muted hover:bg-hover hover:text-text-primary"
        onClick={handleAdd}
      >
        + Add repo
      </button>
      {repos.map((r) => (
        <button
          key={r.id}
          className={`text-sm text-left px-2 py-1 rounded ${
            r.id === activeRepoId ? "bg-accent-soft text-accent font-medium" : "text-text-primary hover:bg-hover"
          }`}
          onClick={() => setActiveRepo(r.id)}
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}
