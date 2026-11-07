import { GitBranch, GitPullRequest, GitCompare, PlayCircle, Settings, type LucideIcon } from "lucide-react";
import { useViewStore } from "../store/viewStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import RepoList from "./RepoList";
import BranchTree from "./BranchTree";
// import WorkingCopyPanel from "./WorkingCopyPanel";
import ResizeHandle from "./ResizeHandle";
import SettingsModal from "./SettingsModal";
import CreateBranchDialog from "./CreateBranchDialog";
import ReleaseNotesDialog from "./ReleaseNotesDialog";
import DirtyCheckoutDialog from "./DirtyCheckoutDialog";
import { useResizable } from "../hooks/useResizable";
import { isCompactTabs } from "../lib/sidebarTabs";
import { useSettingsModalStore } from "../store/settingsModalStore";
import logo from "../assets/logo.svg";

const TABS: { view: "repo" | "pulls" | "compare" | "actions"; label: string; Icon: LucideIcon }[] = [
  { view: "repo", label: "Repo", Icon: GitBranch },
  { view: "pulls", label: "PRs", Icon: GitPullRequest },
  { view: "compare", label: "Compare", Icon: GitCompare },
  { view: "actions", label: "Actions", Icon: PlayCircle },
];

const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 340;

export default function Sidebar() {
  const { size, onMouseDown } = useResizable(DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH, "x");
  const compact = isCompactTabs(size);
  const { activeView, setActiveView } = useViewStore();
  const { activeRepoId, repos } = useWorkspaceStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const isSettingsOpen = useSettingsModalStore((s) => s.isOpen);
  const openSettings = useSettingsModalStore((s) => s.open);
  const closeSettings = useSettingsModalStore((s) => s.close);

  return (
    <div
      className="relative flex-shrink-0 border-r border-border-subtle bg-surface h-full flex flex-col"
      style={{ width: size }}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <img src={logo} alt="Bettertree" width={22} height={22} className="shrink-0" draggable={false} />
        {!compact && <span className="text-sm font-semibold tracking-tight text-text-primary">Bettertree</span>}
      </div>
      <div className="flex items-center gap-1 p-2 border-b border-border-subtle">
        {TABS.map(({ view, label, Icon }) => (
          <button
            key={view}
            type="button"
            aria-label={compact ? label : undefined}
            title={compact ? label : undefined}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1 text-xs py-1 rounded ${compact ? "px-1" : "px-2"} ${
              activeView === view ? "bg-accent text-accent-contrast" : "bg-elevated border border-border-subtle text-text-primary"
            }`}
            onClick={() => setActiveView(view)}
          >
            <Icon size={compact ? 14 : 12} />
            {!compact && <span className="truncate">{label}</span>}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <RepoList />
        <BranchTree />
        {/* <WorkingCopyPanel /> — hidden until Staged/Changes split is designed */}
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border-subtle">
        <span className="flex-1 min-w-0 truncate text-xs text-text-muted" title={activeRepo?.path ?? ""}>
          {activeRepo?.path ?? ""}
        </span>
        <button
          type="button"
          aria-label="Open settings"
          className="text-text-muted hover:text-text-primary px-1"
          onClick={() => openSettings()}
        >
          <Settings size={14} />
        </button>
      </div>
      <ResizeHandle axis="x" edge="end" onMouseDown={onMouseDown} />
      <CreateBranchDialog />
      <ReleaseNotesDialog />
      <DirtyCheckoutDialog />
      {isSettingsOpen && <SettingsModal onClose={closeSettings} />}
    </div>
  );
}
