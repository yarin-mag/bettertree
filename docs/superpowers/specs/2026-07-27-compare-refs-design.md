# Compare Refs (Tag/Branch Diff) — Design

## Goal

Let the user pick two refs (tags or branches) and see which commits exist in one but not the other — the common case being "version A" vs "version B" of the same lineage, where the newer tag has commits the older one doesn't. Exposed as a new top-level "Compare" tab, with three interchangeable ways to view the same result: Table, Graph, Timeline.

## Non-goals

- Not a full diff/merge tool — no conflict resolution, no three-way merge.
- Not scoped to file-level diffs between the two refs (that's a separate, already-existing single-commit diff viewer). Compare is about *which commits*, not *what changed in the files*.
- Not limited to tags only — branches are pickable too, since the underlying operation (symmetric difference between two ref tips) is identical either way.

## Architecture

### Backend

New module `src-tauri/src/compare.rs`:

```rust
pub struct CompareCommit {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
    pub lane: u32,
    pub edges: Vec<GraphEdge>,     // reuses graph.rs's GraphEdge
    pub active_lanes: Vec<bool>,
}

pub struct CompareResult {
    pub base_oid: String,
    pub compare_oid: String,
    pub merge_base_oid: Option<String>,   // None if histories are unrelated
    pub only_in_base: Vec<CompareCommit>,
    pub only_in_compare: Vec<CompareCommit>,
}

pub fn compare_refs(repo_path: &str, base_ref: &str, compare_ref: &str) -> Result<CompareResult, AppError>;
```

Implementation:
1. Resolve `base_ref`/`compare_ref` to OIDs (tag or branch name — `revparse_single`, same resolution the rest of the app already relies on for tags/branches).
2. `repo.merge_base(base_oid, compare_oid)` — if it errors (unrelated histories), proceed with `merge_base_oid: None` and don't hide anything (both directions become "everything reachable from that tip", which is the correct degenerate behavior).
3. Two revwalks for the flat/table data:
   - `only_in_compare`: push `compare_oid`, hide `merge_base_oid` (if any), collect commit metadata (oid/summary/author/timestamp).
   - `only_in_base`: same, swapped.
4. One combined revwalk for lane assignment (graph mode): push **both** tips, hide `merge_base_oid`, feed the resulting ordered commit list through the *existing* `graph.rs` lane-assignment logic (extracted so it operates on an arbitrary revwalk, not just the "HEAD + limit" one `get_commit_graph` uses). This produces `lane`/`edges`/`active_lanes` per commit; the frontend already knows how to render that shape via `CommitGraphRow`.
5. `only_in_base`/`only_in_compare` in `CompareResult` reuse `CompareCommit`, which is a superset of what table/timeline need — table and timeline just ignore `lane`/`edges`/`active_lanes`.

New command in `commands.rs`:
```rust
#[tauri::command]
pub async fn compare_refs(repo_path: String, base_ref: String, compare_ref: String) -> Result<CompareResult, AppError>
```

Same-commit case (`base_oid == compare_oid`): return early with both lists empty — frontend renders the "Identical" empty state, no special backend error needed.

### Frontend

- `viewStore.ts`: `activeView` gains a third value `"compare"`. `Sidebar.tsx` gets a third tab button next to Repo / Pull Requests.
- `store/compareStore.ts` (new):
  ```ts
  interface CompareState {
    baseRef: string | null;
    compareRef: string | null;
    result: CompareResult | null;
    isLoading: boolean;
    error: string | null;
    setBaseRef: (ref: string) => void;
    setCompareRef: (ref: string) => void;
    loadCompare: (repoPath: string) => Promise<void>;
  }
  ```
  `loadCompare` is only called explicitly (e.g. a "Compare" button, or auto-fire once both refs are picked) — not on every keystroke.
- `components/CompareScreen.tsx` (new): two ref pickers (`RefCombobox` — see below), a direction toggle (`New only` / `Both directions`, persisted in local component state, not the store, since it's a pure render concern), a view-mode segmented control (`Table` / `Graph` / `Timeline`), and the result rendering.
- `components/RefCombobox.tsx` (new component, not a modification of `BranchCombobox`): lists both branches and tags in one dropdown, visually grouped ("Branches" / "Tags") the way `BranchCombobox` already groups local/remote. Kept separate so this feature can't regress the existing PR branch-filter picker.
- Table mode: reuses the plain-row rendering `CommitGraphRow` already has for `showGraphLines={false}` (message/author/date columns) — one list per direction when "Both" is selected, each with a small header ("Only in v1.2.0" / "Only in v1.3.0").
- Graph mode: renders `only_in_base` + `only_in_compare` merged and sorted by the backend-provided `lane`/`edges` via `CommitGraphRow` with `showGraphLines={true}`, same as `CommitGraph.tsx` does today — literally the same component, different data source.
- Timeline mode: new `CompareTimeline.tsx` — two CSS columns, commits sorted by `timestamp` within each column, no lane math at all.
- Direction toggle interacts with view mode: "New only" hides the `onlyInBase` column/section in every mode (including Graph — lane data for those commits already came back from the backend either way, so this is just a client-side filter, no refetch).

## Data flow

1. User opens Compare tab → `CompareScreen` mounts, `branches`/`tags` already available in `workspaceStore` (loaded on `setActiveRepo`, no new fetch needed for the pickers themselves).
2. User picks base + compare ref → `compareStore.loadCompare(repoPath)` fires → backend does the two/three revwalks → `CompareResult` lands in the store.
3. Switching view mode or direction toggle: pure re-render off the same `result`, zero backend calls.
4. Switching refs: re-fires `loadCompare`.

## Error handling

- Ref fails to resolve (deleted tag, stale branch since last refresh): backend returns `AppError::Operation("ref '<name>' not found")`, surfaced as inline text under the picker, not a toast/crash.
- Identical refs: empty-state message "Identical — no differences" instead of two empty lists with no explanation.
- Unrelated histories (`merge_base` fails): both directions just show "everything reachable from that tip" per the degenerate behavior above; no error, since that's a legitimate (if unusual) repo state.

## Testing

**Rust** (`compare.rs`, following the `pr_diff.rs` test-file pattern — synthetic repo built in-test):
- Two branches diverging from a shared root: `only_in_compare`/`only_in_base` each contain exactly the expected commits, shared history excluded.
- Identical refs → both lists empty.
- Unrelated histories (two roots, no common ancestor) → no panic, both directions return their full reachable set.
- Lane/edge assignment on the combined walk matches expectations for a simple two-branch fork (mirrors existing `graph.rs` lane tests, adapted to the hide-at-merge-base seeding).

**Frontend**:
- `compareStore`: `loadCompare` populates `result`; ref pickers use existing `branches`/`tags` from `workspaceStore` (no duplicate fetch).
- `CompareScreen`: renders table rows for both directions; graph mode renders via `CommitGraphRow` with correct dot count; timeline mode renders two columns; direction toggle hides/shows without triggering a refetch (assert `compare_refs` invoke call count stays at 1 across toggle clicks); identical-refs empty state; ref-not-found inline error.
