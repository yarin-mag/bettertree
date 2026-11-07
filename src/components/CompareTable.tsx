import CommitGraphRow from "./CommitGraphRow";
import type { CompareResult, CommitSummary } from "../lib/tauri";
import type { CompareDirection } from "./CompareScreen";

interface CompareTableProps {
  result: CompareResult;
  baseRef: string;
  compareRef: string;
  direction: CompareDirection;
}

function toRow(c: CommitSummary) {
  return { ...c, lane: 0, edges: [], activeLanes: [] };
}

export default function CompareTable({ result, baseRef, compareRef, direction }: CompareTableProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="text-xs font-medium text-text-muted mb-1">Only in {compareRef}</div>
        {result.onlyInCompare.length === 0 ? (
          <div className="text-xs text-text-muted">No unique commits</div>
        ) : (
          result.onlyInCompare.map((c) => <CommitGraphRow key={c.oid} commit={toRow(c)} showGraphLines={false} />)
        )}
      </div>
      {direction === "both" && (
        <div>
          <div className="text-xs font-medium text-text-muted mb-1">Only in {baseRef}</div>
          {result.onlyInBase.length === 0 ? (
            <div className="text-xs text-text-muted">No unique commits</div>
          ) : (
            result.onlyInBase.map((c) => <CommitGraphRow key={c.oid} commit={toRow(c)} showGraphLines={false} />)
          )}
        </div>
      )}
    </div>
  );
}
