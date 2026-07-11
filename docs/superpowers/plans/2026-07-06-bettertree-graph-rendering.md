# Bettertree Commit Graph Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw real connector lines (curved) between commits across lanes, with each lane getting a distinct color (lane 0 / HEAD always amber), so the commit graph reads as an actual graph instead of a stack of same-colored dots.

**Architecture:** `graph.rs` exposes a new `active_lanes: Vec<bool>` field per commit — a snapshot of the lane-occupancy bookkeeping the algorithm already computes internally but currently discards. The frontend compares consecutive rows' `active_lanes` to know exactly which lanes need pass-through lines, and uses each commit's own `edges` to draw curved connectors to parent lanes. A new `laneColor()` utility maps lane index to color.

**Tech Stack:** Same as the rest of the project — Rust/git2 backend, React/TypeScript/SVG frontend.

**Relationship to spec:** Implements `docs/superpowers/specs/2026-07-06-bettertree-graph-rendering.md` in full. **One scope resolution made during planning, not covered by the spec:** when the quick branch/commit-name search filter (`SearchBar`, from Plan 1) is narrowing the visible commit list, the graph's lane bookkeeping is only valid relative to the *full*, unfiltered history — a filtered subset breaks the adjacency `active_lanes` comparisons depend on (row N's "previous row" is no longer actually adjacent in real history). Resolution: when a search query is active, `CommitGraph` falls back to the pre-existing simple rendering (single accent dot, no lines) for every row; full graph rendering only applies to the unfiltered view. This preserves a working (if simpler) view while filtering rather than ever drawing incorrect lines.

## Global Constraints

- No git version control for this project — no commits. Every task's last step is "mark task complete."
- Lane 0's dot position must stay exactly `12 + 0 * 16 = 12` — existing tests from Plan 1/3 assert `cx="12"` and must keep passing unmodified in behavior (their fixture data changes to stay valid against the new required `activeLanes` field, but the assertions themselves are unchanged).
- No change to the lane *assignment* algorithm (which lane a commit gets) — only exposing existing internal state and rendering on top of it.
- Colors are the same fixed values in both light and dark themes (small dots/lines, not treated as theme-sensitive text).
- Full regression (`cargo test`, `npm test`, `npm run e2e`, `npm run build`) at the end of the last task.

---

## File Structure

```
bettertree/
  src-tauri/src/
    graph.rs                    # MODIFY: add active_lanes field, camelCase rename, new tests
  src/
    lib/
      tauri.ts                    # MODIFY: add activeLanes to GraphCommit interface
      laneColor.ts                   # NEW: lane index -> color mapping
    components/
      CommitGraph.tsx                  # MODIFY: pass prevActiveLanes + filtered-view fallback flag
      CommitGraphRow.tsx                  # MODIFY: full line/curve/color rendering
    __tests__/
      laneColor.test.ts                     # NEW
      CommitGraph.test.tsx                    # MODIFY: updated fixtures, new line-rendering assertions
```

`laneColor.ts` is a pure, standalone mapping function — no React, no SVG — kept separate so the color rule is independently testable and reusable if any other view ever needs to show a lane's color consistently (e.g., a future branch-list color-coding).

---

### Task 1: Backend — expose lane occupancy per commit

**Files:**
- Modify: `src-tauri/src/graph.rs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GraphCommit` gains `pub active_lanes: Vec<bool>` and the struct gains `#[serde(rename_all = "camelCase")]`. Task 2's `GraphCommit` TS interface adds the matching `activeLanes: boolean[]` field.

- [ ] **Step 1: Write the failing tests**

Replace the `#[cfg(test)] mod tests` block in `src-tauri/src/graph.rs` with this (it extends the existing tests with `active_lanes` assertions and adds two new tests):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{init_repo_with_commits, init_repo_with_commits_and_merge};

    #[test]
    fn graph_edge_serializes_with_camel_case_keys() {
        let edge = GraphEdge { parent_oid: "abc".into(), parent_lane: 2 };
        let json = serde_json::to_string(&edge).unwrap();
        assert!(json.contains("\"parentOid\""), "json was: {json}");
        assert!(json.contains("\"parentLane\""), "json was: {json}");
    }

    #[test]
    fn graph_commit_serializes_with_camel_case_keys() {
        let commit = GraphCommit {
            oid: "abc".into(),
            summary: "test".into(),
            author: "Test".into(),
            timestamp: 0,
            lane: 0,
            edges: vec![],
            active_lanes: vec![true],
        };
        let json = serde_json::to_string(&commit).unwrap();
        assert!(json.contains("\"activeLanes\""), "json was: {json}");
    }

    #[test]
    fn linear_history_stays_in_single_lane() {
        let (dir, _repo) = init_repo_with_commits();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 10).unwrap();
        assert_eq!(graph.len(), 2);
        assert!(graph.iter().all(|c| c.lane == 0));
        assert_eq!(graph[0].summary, "second commit");
        assert_eq!(graph[1].summary, "first commit");
        // "second commit" has a parent, so lane 0 stays occupied afterward.
        assert_eq!(graph[0].active_lanes, vec![true]);
        // "first commit" is the root — it clears its own lane.
        assert_eq!(graph[1].active_lanes, vec![false]);
    }

    #[test]
    fn merge_commit_has_two_parent_edges() {
        let (dir, _repo) = init_repo_with_commits_and_merge();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 10).unwrap();
        let merge_commit = graph
            .iter()
            .find(|c| c.summary == "merge feature")
            .expect("merge commit present");
        assert_eq!(merge_commit.edges.len(), 2);
        // Both parents get their own lane, both occupied after this row.
        assert_eq!(merge_commit.active_lanes, vec![true, true]);
    }

    #[test]
    fn active_lanes_reflects_pass_through_lanes_in_a_branch_and_merge_history() {
        let (dir, _repo) = init_repo_with_commits_and_merge();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 10).unwrap();

        let feature_commit_row = graph
            .iter()
            .find(|c| c.summary == "feature commit")
            .expect("feature commit present");

        // main's lane (0) is still active here even though this row's own
        // commit sits on lane 1 — proves pass-through data is exposed, not
        // just the current commit's own lane.
        assert!(feature_commit_row.active_lanes[0]);
        assert!(feature_commit_row.active_lanes[1]);
    }

    #[test]
    fn respects_limit() {
        let (dir, _repo) = init_repo_with_commits();
        let graph = get_commit_graph(dir.path().to_str().unwrap(), 1).unwrap();
        assert_eq!(graph.len(), 1);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml graph::tests`
Expected: FAIL to compile — `GraphCommit` has no `active_lanes` field yet.

- [ ] **Step 3: Write the implementation**

Modify the `GraphCommit` struct definition and the push site in `src-tauri/src/graph.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
    pub lane: usize,
    pub edges: Vec<GraphEdge>,
    pub active_lanes: Vec<bool>,
}
```

Modify the end of the loop body in `get_commit_graph` — capture the occupancy snapshot right after the existing edge-processing `if`/`else` block, before building the `GraphCommit`:

```rust
        let active_lanes: Vec<bool> = lanes.iter().map(|slot| slot.is_some()).collect();

        let author = commit.author();
        out.push(GraphCommit {
            oid: oid_str,
            summary: commit.summary().unwrap_or("").to_string(),
            author: author.name().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            lane,
            edges,
            active_lanes,
        });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml graph::tests`
Expected: `test result: ok. 6 passed; 0 failed`

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests from every prior plan pass, plus this task's tests.

- [ ] **Step 6: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 2: Frontend types and lane color utility

**Files:**
- Modify: `src/lib/tauri.ts`
- Create: `src/lib/laneColor.ts`
- Create: `src/__tests__/laneColor.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GraphCommit.activeLanes: boolean[]` (added to the existing interface); `laneColor(lane: number): string`. Task 3's `CommitGraphRow`/`CommitGraph` consume both.

- [ ] **Step 1: Write the failing test**

`src/__tests__/laneColor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { laneColor } from "../lib/laneColor";

describe("laneColor", () => {
  it("lane 0 is always the accent color", () => {
    expect(laneColor(0)).toBe("var(--accent)");
  });

  it("cycles through the palette for lanes 1+", () => {
    expect(laneColor(1)).toBe("#4ea1f0");
    expect(laneColor(2)).toBe("#c785f0");
    expect(laneColor(6)).toBe(laneColor(1)); // wraps around after 5 palette colors
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run laneColor`
Expected: FAIL — `src/lib/laneColor` does not exist yet.

- [ ] **Step 3: Write the implementation**

`src/lib/laneColor.ts`:

```typescript
const PALETTE = ["#4ea1f0", "#c785f0", "#4ad999", "#f0625f", "#e8d347"];

export function laneColor(lane: number): string {
  if (lane === 0) return "var(--accent)";
  return PALETTE[(lane - 1) % PALETTE.length];
}
```

Add `activeLanes: boolean[];` to the `GraphCommit` interface in `src/lib/tauri.ts`:

```typescript
export interface GraphCommit {
  oid: string;
  summary: string;
  author: string;
  timestamp: number;
  lane: number;
  edges: GraphEdge[];
  activeLanes: boolean[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run laneColor`
Expected: both tests pass.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 3: CommitGraphRow / CommitGraph rendering

**Files:**
- Modify: `src/components/CommitGraphRow.tsx`
- Modify: `src/components/CommitGraph.tsx`
- Modify: `src/__tests__/CommitGraph.test.tsx`

**Interfaces:**
- Consumes: `laneColor` (Task 2), `GraphCommit.activeLanes` (Task 2).
- Produces: nothing new for later tasks — last functional task in this plan.

- [ ] **Step 1: Update the existing test fixtures and write the new failing tests**

Replace `src/__tests__/CommitGraph.test.tsx` in full:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import CommitGraph from "../components/CommitGraph";

describe("CommitGraph", () => {
  beforeEach(() => {
    useSearchStore.setState({ query: "" });
    useWorkspaceStore.setState({
      commits: [
        {
          oid: "c2",
          summary: "second commit",
          author: "Test User",
          timestamp: 200,
          lane: 0,
          edges: [{ parentOid: "c1", parentLane: 0 }],
          activeLanes: [true],
        },
        {
          oid: "c1",
          summary: "first commit",
          author: "Test User",
          timestamp: 100,
          lane: 0,
          edges: [],
          activeLanes: [false],
        },
      ],
    });
  });

  it("renders one row per commit with its summary and lane", () => {
    render(<CommitGraph />);
    const rows = screen.getAllByTestId("commit-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("second commit")).toBeInTheDocument();
    expect(screen.getByText("first commit")).toBeInTheDocument();
  });

  it("positions each row's dot according to its lane", () => {
    render(<CommitGraph />);
    const dots = screen.getAllByTestId("commit-dot");
    expect(dots[0]).toHaveAttribute("cx", "12");
    expect(dots[1]).toHaveAttribute("cx", "12");
  });

  it("draws a curved connector for a merge commit with two different-lane edges", () => {
    useWorkspaceStore.setState({
      commits: [
        {
          oid: "m1",
          summary: "merge feature",
          author: "Test User",
          timestamp: 300,
          lane: 0,
          edges: [
            { parentOid: "c2", parentLane: 0 },
            { parentOid: "f1", parentLane: 1 },
          ],
          activeLanes: [true, true],
        },
      ],
    });
    render(<CommitGraph />);
    const paths = document.querySelectorAll("path");
    // One curved <path> for the cross-lane edge (lane 0 -> lane 1); the
    // same-lane edge (0 -> 0) is a straight line, not a path.
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a plain single-color dot when a search query is filtering the list", () => {
    useSearchStore.setState({ query: "second" });
    render(<CommitGraph />);
    const dot = screen.getByTestId("commit-dot");
    expect(dot).toHaveAttribute("fill", "var(--accent)");
    expect(dot).toHaveAttribute("cx", "12");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run CommitGraph`
Expected: FAIL — `CommitGraph`/`CommitGraphRow` don't yet accept/use `activeLanes`, draw curves, or handle the filtered fallback.

- [ ] **Step 3: Write the implementation**

Replace `src/components/CommitGraphRow.tsx` in full:

```typescript
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
```

Replace `src/components/CommitGraph.tsx` in full:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run CommitGraph`
Expected: all 4 tests pass.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 4: Full regression

**Files:** none — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all Vitest suites pass, including this plan's new/updated tests.

Run: `npm run e2e`
Expected: all 3 existing Playwright specs still pass — none of them assert on graph line/curve rendering, only on `commit-row`/`commit-dot` presence and text content, which are unchanged in the unfiltered (non-search) views those specs exercise.

**Correction found here:** all 3 specs initially failed — `e2e/mockTauri.ts`'s `commitsByPath` fixture (not listed in this plan's File Structure, since it predates this plan) has no `activeLanes` field, and `CommitGraphRow` reads `commit.activeLanes.length`, throwing and crashing the whole app render before any test's `getByText("Branches")` could resolve. Fixed by adding `activeLanes: [true]` to the `"second commit"` fixture entry (it has a parent, matching real backend output) and `activeLanes: [false]` to `"first commit"` (the root, matching `graph.rs`'s own test expectations for an equivalent fixture).

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests pass, including this plan's updated/new `graph::tests`.

Run: `npm run build`
Expected: succeeds — this plan touches `.tsx`/`.ts` files with real type changes (`GraphCommit.activeLanes`), so a real `tsc` pass (not just Vitest's transform) is the meaningful check here, per the lesson from the diff-highlighting plan.

- [ ] **Step 2: Mark task complete**

No commit (see Global Constraints). Update the progress ledger — commit graph rendering is now complete.

---

## Definition of Done

- The commit graph draws real curved connector lines between commits and their parents across lanes, correctly for linear history, branches, and merges — verified by Rust tests asserting `active_lanes` shape and frontend tests asserting rendered line/curve elements.
- Each lane has a distinct color; lane 0 (always the current branch) is the amber accent; other lanes cycle through a fixed 5-color palette.
- Filtering via the search bar falls back to the simple single-dot view rather than ever rendering incorrect lines.
- `cargo test`, `npm test`, `npm run e2e`, and `npm run build` all pass with no regressions from any prior plan.
