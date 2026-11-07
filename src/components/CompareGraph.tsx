import CommitGraphRow from "./CommitGraphRow";
import type { CompareResult } from "../lib/tauri";
import type { CompareDirection } from "./CompareScreen";

interface CompareGraphProps {
  result: CompareResult;
  direction: CompareDirection;
}

export default function CompareGraph({ result, direction }: CompareGraphProps) {
  const visible =
    direction === "both"
      ? result.graph
      : result.graph.filter((c) => result.onlyInCompare.some((s) => s.oid === c.oid));

  return (
    <div className="flex-1 overflow-y-auto bg-canvas">
      {visible.map((c, i) => (
        <CommitGraphRow key={c.oid} commit={c} prevActiveLanes={visible[i - 1]?.activeLanes} showGraphLines={true} />
      ))}
    </div>
  );
}
