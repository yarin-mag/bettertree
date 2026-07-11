import { useState } from "react";
import { GitBranch, Tag as TagIcon } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { fuzzyMatch } from "../lib/fuzzyMatch";

export default function BranchTree() {
  const { branches, tags, repos, activeRepoId, switchBranch } = useWorkspaceStore();
  const { query } = useSearchStore();
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const local = branches.filter((b) => !b.isRemote && fuzzyMatch(query, b.name));
  const remote = branches.filter((b) => b.isRemote && fuzzyMatch(query, b.name));
  const filteredTags = tags.filter((t) => fuzzyMatch(query, t.name));

  const handleSwitch = async (branchName: string, isRemote: boolean) => {
    setError(null);
    try {
      await switchBranch(activeRepo?.path as string, branchName, isRemote);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="text-sm p-2">
      <div className="text-xs uppercase text-text-muted mt-2">Branches</div>
      {error && <div className="text-xs text-danger px-2 py-0.5">{error}</div>}
      <div className="max-h-48 overflow-y-auto">
        {local.map((b) => (
          <div
            key={b.name}
            data-head={b.isHead}
            onDoubleClick={() => handleSwitch(b.name, false)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer ${
              b.isHead ? "bg-accent-soft text-accent font-medium" : "text-text-primary"
            }`}
          >
            <GitBranch size={12} />
            <span>{b.name}</span>
          </div>
        ))}
      </div>
      <div className="text-xs uppercase text-text-muted mt-2">Remotes</div>
      <div className="max-h-40 overflow-y-auto">
        {remote.map((b) => (
          <div
            key={b.name}
            data-head={b.isHead}
            onDoubleClick={() => handleSwitch(b.name, true)}
            className="flex items-center gap-1.5 px-2 py-0.5 text-text-muted cursor-pointer"
          >
            <GitBranch size={12} />
            <span>{b.name}</span>
          </div>
        ))}
      </div>
      <div className="text-xs uppercase text-text-muted mt-2">Tags</div>
      <div className="max-h-40 overflow-y-auto">
        {filteredTags.map((t) => (
          <div key={t.name} className="flex items-center gap-1.5 px-2 py-0.5 text-text-primary">
            <TagIcon size={12} />
            <span>{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
