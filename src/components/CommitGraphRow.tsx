import { Star } from "lucide-react";
import { GraphCommit } from "../lib/tauri";
import { useUiStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { usePinnedStore } from "../store/pinnedStore";
import { laneColor } from "../lib/laneColor";
import type { CommitRefs } from "../lib/refsByOid";
import { useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { useBranchActionStore } from "../store/branchActionStore";
import { useReleaseNotesStore, selectPicking } from "../store/releaseNotesStore";
import { releaseNotesEnd, releaseNotesSinceTag } from "../lib/releaseNotes";
import CiBadge, { useCiBadge } from "./CiBadge";
import TruncatedBadge from "./TruncatedBadge";
import { checkoutBranch, cherryPickCommit, copyWithToast, jumpToCommit } from "../lib/branchActions";

const LANE_WIDTH = 16;
export const ROW_HEIGHT = 24;
const LANE_X0 = 12;

function laneX(lane: number): number {
  return LANE_X0 + lane * LANE_WIDTH;
}

interface Props {
  commit: GraphCommit;
  prevActiveLanes?: boolean[];
  showGraphLines: boolean;
  refs?: CommitRefs;
  active?: boolean;
  /** Inside the release-notes range being previewed while picking. */
  inRange?: boolean;
  onHover?: () => void;
}

function RefBadges({ refs }: { refs?: CommitRefs }) {
  const branches = useWorkspaceStore((s) => s.branches);
  if (!refs || (refs.branches.length === 0 && refs.tags.length === 0)) return null;
  return (
    <span className="flex gap-1 shrink-0 overflow-hidden">
      {refs.branches.map((name) => (
        <TruncatedBadge
          key={`b-${name}`}
          name={name}
          className="bg-accent-soft text-accent"
          onClick={() => {
            const tip = branches.find((b) => b.name === name)?.targetOid;
            if (tip) void jumpToCommit(tip);
          }}
        />
      ))}
      {refs.tags.map((name) => (
        <TruncatedBadge key={`t-${name}`} name={name} className="bg-merged-soft text-merged" />
      ))}
    </span>
  );
}

function CommitBadgeSlot({ oid }: { oid: string }) {
  const { state, title } = useCiBadge(oid);
  return (
    <CiBadge
      state={state}
      title={title}
      onClick={() => {
        useUiStore.getState().selectCommit(oid);
        useUiStore.getState().setDrawerTab("checks");
      }}
    />
  );
}

function PinButton({ oid, summary }: { oid: string; summary: string }) {
  const activeRepo = useWorkspaceStore((s) => s.repos.find((r) => r.id === s.activeRepoId));
  const isCommitPinned = usePinnedStore((s) => s.isCommitPinned);
  const toggleCommit = usePinnedStore((s) => s.toggleCommit);
  if (!activeRepo) return null;
  const pinned = isCommitPinned(activeRepo.path, oid);
  return (
    <button
      className={`shrink-0 press-scale transition-opacity duration-100 ${pinned ? "text-accent" : "text-text-muted opacity-0 group-hover:opacity-100"}`}
      title={pinned ? "Unpin commit" : "Pin commit"}
      onClick={(e) => {
        e.stopPropagation();
        toggleCommit({ repoPath: activeRepo.path, oid, summary });
      }}
    >
      <Star size={11} fill={pinned ? "currentColor" : "none"} />
    </button>
  );
}

function RangeMarker({ oid }: { oid: string }) {
  const isFrom = useReleaseNotesStore((s) => s.from?.oid === oid);
  const isTo = useReleaseNotesStore((s) => s.to?.oid === oid);
  if (!isFrom && !isTo) return null;
  return (
    <span
      aria-label={isFrom ? "Release notes start" : "Release notes end"}
      title={isFrom ? "Release notes start (excluded)" : "Release notes end (included)"}
      className="shrink-0 rounded px-1 text-[10px] bg-accent-soft text-accent"
    >
      {isFrom ? "from" : "to"}
    </span>
  );
}

export default function CommitGraphRow({ commit, prevActiveLanes, showGraphLines, refs, active, inRange, onHover }: Props) {
  const storeSelectCommit = useUiStore((s) => s.selectCommit);
  const picking = useReleaseNotesStore(selectPicking);
  // While a release-notes range is half-marked, a click picks the other end instead of selecting.
  const selectCommit = (oid: string) =>
    picking ? useReleaseNotesStore.getState().pick(releaseNotesEnd(commit, refs?.tags)) : storeSelectCommit(oid);
  const date = new Date(commit.timestamp * 1000).toLocaleDateString();
  const rowTint = active || inRange ? "bg-accent-soft" : "hover:bg-hover";
  const branchInfos = useWorkspaceStore((s) => s.branches);
  const openCreateBranch = useBranchActionStore((s) => s.openCreateBranch);
  const { openMenu, menu } = useContextMenu();

  const onContextMenu = (e: React.MouseEvent) => {
    const items: ContextMenuItem[] = [];
    for (const name of refs?.branches ?? []) {
      const info = branchInfos.find((b) => b.name === name);
      if (info && !info.isHead) items.push({ label: `Checkout ${name}`, onSelect: () => void checkoutBranch(name, info.isRemote) });
    }
    items.push(
      { label: "Copy SHA", onSelect: () => void copyWithToast(commit.oid, "SHA"), separatorBefore: items.length > 0 },
      { label: "Create branch here…", onSelect: () => openCreateBranch(commit.oid, `${commit.oid.slice(0, 7)} ${commit.summary}`) },
      { label: "Cherry-pick this commit", onSelect: () => void cherryPickCommit(commit.oid) }
    );
    const end = releaseNotesEnd(commit, refs?.tags);
    items.push(
      { label: "Release notes: from here", onSelect: () => useReleaseNotesStore.getState().markFrom(end), separatorBefore: true },
      { label: "Release notes: to here", onSelect: () => useReleaseNotesStore.getState().markTo(end) }
    );
    for (const tag of refs?.tags ?? []) {
      items.push({
        label: `Release notes since ${tag}`,
        onSelect: () => releaseNotesSinceTag({ name: tag, targetOid: commit.oid }),
      });
    }
    openMenu(e, items);
  };

  if (!showGraphLines) {
    return (
      <div
        data-testid="commit-row"
        className={`group flex items-center gap-1 h-6 text-sm cursor-pointer text-text-primary transition-colors duration-100 ${rowTint}`}
        style={{ height: ROW_HEIGHT }}
        onClick={() => selectCommit(commit.oid)}
        onContextMenu={onContextMenu}
        onMouseEnter={onHover}
        data-in-range={inRange ? "true" : undefined}
      >
        <svg width={24} height={ROW_HEIGHT} className="shrink-0">
          <circle data-testid="commit-dot" cx={LANE_X0} cy={ROW_HEIGHT / 2} r={4} fill="var(--accent)" />
        </svg>
        <PinButton oid={commit.oid} summary={commit.summary} />
        <RangeMarker oid={commit.oid} />
        <RefBadges refs={refs} />
        <CommitBadgeSlot oid={commit.oid} />
        <span className="truncate flex-1">{commit.summary}</span>
        <span className="text-text-muted w-16 shrink-0 truncate text-right font-mono text-xs">
          {commit.oid.slice(0, 7)}
        </span>
        <span className="text-text-muted w-24 shrink-0 truncate text-right font-mono text-xs" title={commit.author}>
          {commit.author}
        </span>
        <span className="text-text-muted w-20 shrink-0 truncate text-right font-mono text-xs">{date}</span>
        {menu}
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
      className={`group flex items-center gap-1 h-6 text-sm cursor-pointer text-text-primary transition-colors duration-100 ${rowTint}`}
      style={{ height: ROW_HEIGHT }}
      onClick={() => selectCommit(commit.oid)}
      onContextMenu={onContextMenu}
      onMouseEnter={onHover}
      data-in-range={inRange ? "true" : undefined}
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
      <PinButton oid={commit.oid} summary={commit.summary} />
      <RangeMarker oid={commit.oid} />
      <RefBadges refs={refs} />
      <CommitBadgeSlot oid={commit.oid} />
      <span className="truncate flex-1">{commit.summary}</span>
      <span className="text-text-muted w-16 shrink-0 truncate text-right font-mono text-xs">
        {commit.oid.slice(0, 7)}
      </span>
      <span className="text-text-muted w-24 shrink-0 truncate text-right font-mono text-xs" title={commit.author}>
        {commit.author}
      </span>
      <span className="text-text-muted w-20 shrink-0 truncate text-right font-mono text-xs">{date}</span>
      {menu}
    </div>
  );
}
