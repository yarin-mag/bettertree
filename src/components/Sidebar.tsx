import RepoList from "./RepoList";
import BranchTree from "./BranchTree";
import AdvancedSearch from "./AdvancedSearch";
// import WorkingCopyPanel from "./WorkingCopyPanel";
import ResizeHandle from "./ResizeHandle";
import { useResizable } from "../hooks/useResizable";

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function Sidebar() {
  const { size, onMouseDown } = useResizable(256, MIN_WIDTH, MAX_WIDTH, "x");

  return (
    <div
      className="relative flex-shrink-0 border-r border-border-subtle bg-surface h-full overflow-y-auto flex flex-col"
      style={{ width: size }}
    >
      <RepoList />
      <BranchTree />
      {/* <WorkingCopyPanel /> — hidden until Staged/Changes split is designed */}
      <AdvancedSearch />
      <ResizeHandle axis="x" edge="end" onMouseDown={onMouseDown} />
    </div>
  );
}
