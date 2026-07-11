# Bettertree Commit Graph Rendering

Date: 2026-07-06

## Purpose

The commit graph (right pane) currently renders every commit as a same-colored dot at a lane-based indent, with no connector lines at all — `graph.rs` already computes `edges`/`parentLane` per commit, but the frontend never draws them, and every lane gets the identical amber accent color. This makes it impossible to visually follow a branch's line through history. This spec adds real connector lines (curved, per mockup review) and per-lane colors, accurate for any history shape (linear, branch, merge, interleaved branches).

## Backend Change

`graph::GraphCommit` gains one field: `active_lanes: Vec<bool>` — a snapshot of which lane slots are occupied immediately *after* this commit is processed by the existing lane-assignment algorithm. This is exactly the `lanes: Vec<Option<String>>` bookkeeping `get_commit_graph` already maintains internally; it's currently discarded after computing each row's own `lane`/`edges` and needs to be captured and serialized instead.

`GraphCommit` needs `#[serde(rename_all = "camelCase")]` added (it didn't need it before — no multi-word fields — but `active_lanes` introduces one, and this project has a standing rule that every struct crossing the Tauri IPC boundary with a multi-word field needs this attribute, after a real bug from missing it earlier in the project).

This one field is sufficient for the frontend to derive full pass-through/branch/merge line rendering for any history shape: comparing row `i`'s `active_lanes` to row `i-1`'s tells the frontend exactly which lanes have a line entering/continuing through row `i`, for every lane, not just the current commit's own lane.

## Frontend Rendering

- `CommitGraph.tsx` passes each row's commit plus the *previous* row's `active_lanes` (`undefined` for the first row) down to `CommitGraphRow`.
- `CommitGraphRow` draws, per row:
  - A **dot** at `(lane, center)`, colored by that lane's color.
  - A **top-entering vertical segment** for every lane where the previous row's `active_lanes[lane]` is true — for the row's own `lane`, this segment terminates at the dot; for every other such lane, it's a straight pass-through continuing to the bottom of the row.
  - A **bottom-exiting vertical segment** for every lane this row's own `active_lanes[lane]` leaves true (this includes the row's own lane, unless this commit is a root with no first-parent continuation).
  - A **curved connector** (per the approved mockup — a smooth S-curve, not a sharp diagonal) from this row's `lane` to each `edges[].parentLane`, for every edge — this covers both merges (multiple edges from one commit) and branch points (a lane's line curving into another lane where it originated).
- Lines and dots share one color rule: **a segment's color is the color of the lane it is heading into** — same-lane segments trivially use that lane's color; a diagonal segment from lane A to lane B is colored by B's color (so a merge-in curve from a feature branch shows the feature's color, not the current branch's).

## Color Assignment

- Lane 0 is always the current branch's lane (the revwalk starts at `HEAD`, so the first commit — and therefore lane 0 — is always on the current branch) and is always the amber accent color (`--accent`), matching the existing single-color dot today.
- Lanes 1+ cycle through a fixed palette, same values in both light and dark themes: blue `#4ea1f0`, purple `#c785f0`, green `#4ad999`, red `#f0625f`, yellow `#e8d347`, repeating via `(lane - 1) % 5` for lane counts beyond 5.

## Testing

- Rust: extend `graph.rs`'s existing tests (linear history, merge commit) to assert `active_lanes` has the expected shape — e.g., a merge commit's `active_lanes` reflects both parent lanes correctly; add a new test for a branch-then-merge history verifying a mid-history commit's `active_lanes` shows the expected pass-through lane.
- Frontend: `CommitGraphRow` test(s) verifying the color/lane assignment rule (lane 0 → accent, lane 1 → the first palette color) and that the right number of line segments render for a given `active_lanes`/`edges` input.
- Full regression (`cargo test`, `npm test`, `npm run e2e`) at the end — the existing `commit-dot`/`commit-row` test IDs and `cx` assertions from earlier plans need to keep working, so lane-0 dot positioning must not change from its current `12 + lane * 16` formula.

## Out of Scope

- Any change to the lane *assignment* algorithm itself (which lane a commit gets) — only exposing its existing internal state and rendering lines on top of it.
- User-configurable colors/palette.
- Horizontal scrolling/collapsing for histories with very many simultaneous lanes (wide graphs) — out of scope, a future concern if it comes up.
