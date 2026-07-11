import { GraphCommit } from "../lib/tauri";
import { useUiStore } from "../store/uiStore";
import { laneColor } from "../lib/laneColor";

const LANE_WIDTH = 16;
const ROW_HEIGHT = 24;
const LANE_X0 = 12;

function laneX(lane: number): number {
  return LANE_X0 + lane * LANE_WIDTH;
}

interface Props {
  commit: GraphCommit;
  prevActiveLanes?: boolean[];
  showGraphLines: boolean;
}

export default function CommitGraphRow({ commit, prevActiveLanes, showGraphLines }: Props) {
  const selectCommit = useUiStore((s) => s.selectCommit);
  const date = new Date(commit.timestamp * 1000).toLocaleDateString();

  if (!showGraphLines) {
    return (
      <div
        data-testid="commit-row"
        className="flex items-center h-6 text-sm cursor-pointer hover:bg-hover text-text-primary"
        style={{ height: ROW_HEIGHT }}
        onClick={() => selectCommit(commit.oid)}
      >
        <svg width={24} height={ROW_HEIGHT} className="shrink-0">
          <circle data-testid="commit-dot" cx={LANE_X0} cy={ROW_HEIGHT / 2} r={4} fill="var(--accent)" />
        </svg>
        <span className="truncate flex-1">{commit.summary}</span>
        <span className="text-text-muted w-24 text-right font-mono text-xs">{commit.author}</span>
        <span className="text-text-muted w-20 text-right font-mono text-xs">{date}</span>
      </div>
    );
  }

  const touchedLanes = new Set<number>([commit.lane, ...commit.edges.map((e) => e.parentLane)]);
  const y1 = ROW_HEIGHT / 2;
  const y2 = ROW_HEIGHT;
  const midY = (y1 + y2) / 2;

  const segments: JSX.Element[] = [];

  (prevActiveLanes ?? []).forEach((active, lane) => {
    if (!active) return;
    const x = laneX(lane);
    segments.push(
      <line key={`top-${lane}`} x1={x} y1={0} x2={x} y2={y1} stroke={laneColor(lane)} strokeWidth={2} />
    );
  });

  (prevActiveLanes ?? []).forEach((active, lane) => {
    if (!active || touchedLanes.has(lane)) return;
    const x = laneX(lane);
    segments.push(
      <line key={`bottom-pass-${lane}`} x1={x} y1={y1} x2={x} y2={y2} stroke={laneColor(lane)} strokeWidth={2} />
    );
  });

  commit.edges.forEach((edge, i) => {
    const x1 = laneX(commit.lane);
    const x2 = laneX(edge.parentLane);
    const color = laneColor(edge.parentLane);
    if (x1 === x2) {
      segments.push(<line key={`edge-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={2} />);
    } else {
      segments.push(
        <path
          key={`edge-${i}`}
          d={`M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`}
          stroke={color}
          strokeWidth={2}
          fill="none"
        />
      );
    }
  });

  const maxLaneIndex = Math.max(
    commit.lane,
    (prevActiveLanes?.length ?? 1) - 1,
    commit.activeLanes.length - 1,
    ...commit.edges.map((e) => e.parentLane),
    0
  );
  const svgWidth = laneX(maxLaneIndex) + 12;

  return (
    <div
      data-testid="commit-row"
      className="flex items-center h-6 text-sm cursor-pointer hover:bg-hover text-text-primary"
      style={{ height: ROW_HEIGHT }}
      onClick={() => selectCommit(commit.oid)}
    >
      <svg width={svgWidth} height={ROW_HEIGHT} className="shrink-0">
        {segments}
        <circle
          data-testid="commit-dot"
          cx={laneX(commit.lane)}
          cy={ROW_HEIGHT / 2}
          r={4}
          fill={laneColor(commit.lane)}
        />
      </svg>
      <span className="truncate flex-1">{commit.summary}</span>
      <span className="text-text-muted w-24 text-right font-mono text-xs">{commit.author}</span>
      <span className="text-text-muted w-20 text-right font-mono text-xs">{date}</span>
    </div>
  );
}
