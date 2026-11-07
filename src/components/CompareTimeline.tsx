import { initials } from "../lib/prDisplay";
import { hashHue } from "../lib/hashColor";
import type { CompareResult, CommitSummary } from "../lib/tauri";
import type { CompareDirection } from "./CompareScreen";

interface CompareTimelineProps {
  result: CompareResult;
  baseRef: string;
  compareRef: string;
  direction: CompareDirection;
}

function Column({ title, commits }: { title: string; commits: CommitSummary[] }) {
  const sorted = [...commits].sort((a, b) => b.timestamp - a.timestamp);
  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs font-medium text-text-muted mb-2 truncate">{title}</div>
      <div className="flex flex-col gap-2">
        {sorted.length === 0 ? (
          <div className="text-xs text-text-muted">No unique commits</div>
        ) : (
          sorted.map((c) => (
            <div key={c.oid} className="flex items-start gap-2 text-xs">
              <span
                className="flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold shrink-0 text-white mt-0.5"
                style={{ backgroundColor: `hsl(${hashHue(c.author)}, 55%, 45%)` }}
                title={c.author}
              >
                {initials(c.author)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-text-primary">{c.summary}</div>
                <div className="text-text-muted">{new Date(c.timestamp * 1000).toLocaleDateString()}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function CompareTimeline({ result, baseRef, compareRef, direction }: CompareTimelineProps) {
  return (
    <div className="flex gap-6 p-4">
      <Column title={`Only in ${compareRef}`} commits={result.onlyInCompare} />
      {direction === "both" && <Column title={`Only in ${baseRef}`} commits={result.onlyInBase} />}
    </div>
  );
}
