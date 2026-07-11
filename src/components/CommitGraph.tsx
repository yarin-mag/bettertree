import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { fuzzyMatch } from "../lib/fuzzyMatch";
import CommitGraphRow from "./CommitGraphRow";

export default function CommitGraph() {
  const { commits } = useWorkspaceStore();
  const { query } = useSearchStore();
  const isFiltered = query.length > 0;
  const visible = commits.filter((c) => fuzzyMatch(query, c.summary));

  return (
    <div className="flex-1 overflow-y-auto bg-canvas">
      {visible.map((c, i) => (
        <CommitGraphRow
          key={c.oid}
          commit={c}
          prevActiveLanes={isFiltered ? undefined : visible[i - 1]?.activeLanes}
          showGraphLines={!isFiltered}
        />
      ))}
    </div>
  );
}
