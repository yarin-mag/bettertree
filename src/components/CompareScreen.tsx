import { useEffect, useState } from "react";
import { GitCompare, Equal } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useCompareStore } from "../store/compareStore";
import { useBranchScopeStore } from "../store/branchScopeStore";
import EmptyState from "./EmptyState";
import RefCombobox from "./RefCombobox";
import CompareTable from "./CompareTable";
import CompareGraph from "./CompareGraph";
import CompareTimeline from "./CompareTimeline";

type ViewMode = "table" | "graph" | "timeline";
export type CompareDirection = "new-only" | "both";

export default function CompareScreen() {
  const { activeRepoId, repos, branches, tags } = useWorkspaceStore();
  const { baseRef, compareRef, result, isLoading, error, setBaseRef, setCompareRef, loadCompare } = useCompareStore();
  const { showRemoteBranches } = useBranchScopeStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [direction, setDirection] = useState<CompareDirection>("both");

  const branchNames = branches.filter((b) => showRemoteBranches || !b.isRemote).map((b) => b.name);
  const tagNames = tags.map((t) => t.name);

  useEffect(() => {
    if (activeRepo && baseRef && compareRef) {
      loadCompare(activeRepo.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepo?.path, baseRef, compareRef]);

  const identical = result != null && result.onlyInBase.length === 0 && result.onlyInCompare.length === 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-border-subtle">
        <div className="flex items-center gap-3 px-4 pt-3 pb-2 flex-wrap">
          <RefCombobox value={baseRef} onChange={setBaseRef} branches={branchNames} tags={tagNames} placeholder="Base ref" />
          <span className="text-text-muted text-xs shrink-0">compared to</span>
          <RefCombobox value={compareRef} onChange={setCompareRef} branches={branchNames} tags={tagNames} placeholder="Compare ref" />
        </div>
        <div className="flex items-center gap-3 px-4 pb-3 flex-wrap">
          <div className="flex gap-1 bg-elevated p-0.5 rounded w-fit">
            <button
              type="button"
              className={`text-xs px-2 py-0.5 rounded ${direction === "new-only" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
              onClick={() => setDirection("new-only")}
            >
              New only
            </button>
            <button
              type="button"
              className={`text-xs px-2 py-0.5 rounded ${direction === "both" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
              onClick={() => setDirection("both")}
            >
              Both directions
            </button>
          </div>
          <div className="flex-1" />
          <div className="flex gap-1 bg-elevated p-0.5 rounded w-fit">
            <button
              type="button"
              className={`text-xs px-2 py-0.5 rounded ${viewMode === "table" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
              onClick={() => setViewMode("table")}
            >
              Table
            </button>
            <button
              type="button"
              className={`text-xs px-2 py-0.5 rounded ${viewMode === "graph" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
              onClick={() => setViewMode("graph")}
            >
              Graph
            </button>
            <button
              type="button"
              className={`text-xs px-2 py-0.5 rounded ${viewMode === "timeline" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
              onClick={() => setViewMode("timeline")}
            >
              Timeline
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!baseRef || !compareRef ? (
          <EmptyState
            icon={<GitCompare size={18} />}
            title="Pick two refs to compare"
            hint="Choose a base and a compare branch or tag above."
          />
        ) : isLoading ? (
          <div className="p-6 text-sm text-text-muted text-center">Comparing…</div>
        ) : error ? (
          <EmptyState
            variant="error"
            title="Couldn't compare these refs"
            hint="Check that both refs still exist, then try again."
            details={error}
            action={activeRepo ? { label: "Retry", onClick: () => loadCompare(activeRepo.path) } : undefined}
          />
        ) : identical ? (
          <EmptyState
            icon={<Equal size={18} />}
            title="No differences"
            hint={`${baseRef} and ${compareRef} point to identical history.`}
          />
        ) : result ? (
          viewMode === "table" ? (
            <CompareTable result={result} baseRef={baseRef} compareRef={compareRef} direction={direction} />
          ) : viewMode === "graph" ? (
            <CompareGraph result={result} direction={direction} />
          ) : (
            <CompareTimeline result={result} baseRef={baseRef} compareRef={compareRef} direction={direction} />
          )
        ) : null}
      </div>
    </div>
  );
}
