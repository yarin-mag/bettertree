import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import CommitGraph from "./components/CommitGraph";
import SearchBar from "./components/SearchBar";
import Toolbar from "./components/Toolbar";
import CommitDrawer from "./components/CommitDrawer";
import SearchResultsPane from "./components/SearchResultsPane";
import PullRequestsScreen from "./components/PullRequestsScreen";
import ActionsScreen from "./components/ActionsScreen";
import CompareScreen from "./components/CompareScreen";
import CommandPalette from "./components/CommandPalette";
import EmptyState from "./components/EmptyState";
import { FolderGit2 } from "lucide-react";
import { useWorkspaceStore } from "./store/workspaceStore";
import ToastHost from "./components/ToastHost";
import SettingsSync from "./components/SettingsSync";
import { useSearchStore } from "./store/searchStore";
import { useViewStore } from "./store/viewStore";
import { useThemeStore } from "./store/themeStore";
import ShortcutsDialog from "./components/ShortcutsDialog";
import { useGlobalShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSessionRestore } from "./hooks/useSessionRestore";

const ZOOM_IN_KEYS = new Set(["+", "="]);
const ZOOM_OUT_KEYS = new Set(["-", "_"]);

export default function App() {
  const { isSearchActive } = useSearchStore();
  const { activeView } = useViewStore();
  const hasActiveRepo = useWorkspaceStore((s) => s.activeRepoId !== null);
  useGlobalShortcuts();
  useSessionRestore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (ZOOM_IN_KEYS.has(e.key)) {
        e.preventDefault();
        useThemeStore.getState().zoomFontSize(1);
      } else if (ZOOM_OUT_KEYS.has(e.key)) {
        e.preventDefault();
        useThemeStore.getState().zoomFontSize(-1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-canvas text-text-primary">
      <SettingsSync />
      <CommandPalette />
      <ToastHost />
      <ShortcutsDialog />
      <Toolbar />
      {activeView === "repo" && <SearchBar />}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        {activeView === "pulls" ? (
          <PullRequestsScreen />
        ) : activeView === "compare" ? (
          <CompareScreen />
        ) : activeView === "actions" ? (
          <ActionsScreen />
        ) : !hasActiveRepo ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<FolderGit2 size={18} />}
              title="No repository selected"
              hint="Add a repository in the sidebar, or pick one you already added, to see its commits."
            />
          </div>
        ) : isSearchActive ? (
          <SearchResultsPane />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <CommitGraph />
            <CommitDrawer />
          </div>
        )}
      </div>
    </div>
  );
}
