# Compare Refs (Tag/Branch Diff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick two refs (tags or branches) and see which commits exist in one but not the other, via a new "Compare" tab with three interchangeable views (Table / Graph / Timeline) over the same result.

**Architecture:** New backend module `compare.rs` computes the symmetric difference between two ref tips (two `git log A..B`-equivalent revwalks, hiding everything at/before the merge-base) plus a combined lane-assigned walk for graph mode (reusing `graph.rs`'s existing lane algorithm, extracted into a shared helper). Frontend gets a new `compareStore`, a new `RefCombobox` (branches + tags), and a `CompareScreen` that renders the same fetched result three different ways with zero refetching when switching view mode or direction.

**Tech Stack:** Rust (git2, existing `AppError`/`run_blocking` conventions), React + TypeScript, Zustand, Tailwind, Vitest + Testing Library.

## Global Constraints

- This project is **not under git version control** (confirmed: no `.git` directory, and an existing project memory records this as the user's explicit call). **Never run `git init`/`add`/`commit`/`branch` here.** Every task below ends with running tests, not a commit step.
- No new dependencies — `git2` (backend), `zustand`/`lucide-react` (frontend) are already in use and cover everything this feature needs.
- Follow the existing serde convention: every new Rust struct exposed to the frontend gets `#[derive(Serialize)]` + `#[serde(rename_all = "camelCase")]`.
- Follow the existing test convention: Rust tests live inline in `#[cfg(test)] mod tests` at the bottom of the module they test, using `crate::test_support` helpers where possible; frontend tests live in the flat `src/__tests__/` directory, one file per component/store.
- Reference spec: `docs/superpowers/specs/2026-07-27-compare-refs-design.md`.

---

### Task 1: Extract a reusable lane-assignment helper in `graph.rs`

**Files:**
- Modify: `src-tauri/src/graph.rs`

**Interfaces:**
- Produces: `pub fn build_graph_commits(repo: &Repository, oids: impl Iterator<Item = Result<git2::Oid, git2::Error>>) -> Result<Vec<GraphCommit>, AppError>` — Task 2's `compare.rs` depends on this exact signature.
- Consumes: nothing new (pure refactor of existing logic).

This is a pure refactor — the lane-assignment loop body inside `get_commit_graph` moves into a new function that takes any oid iterator instead of being hardwired to `revwalk.push_head().take(limit)`. Behavior is unchanged, so the existing test suite is the regression check; no new tests are needed.

- [ ] **Step 1: Extract the loop into `build_graph_commits` and make `get_commit_graph` call it**

Replace the full contents of `src-tauri/src/graph.rs` from `pub fn get_commit_graph` through the end of that function (lines 24-107 as currently written) with:

```rust
pub fn build_graph_commits(
    repo: &Repository,
    oids: impl Iterator<Item = Result<git2::Oid, git2::Error>>,
) -> Result<Vec<GraphCommit>, AppError> {
    // lanes[i] holds the oid this lane is waiting to see next, or None if free.
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut out = Vec::new();

    for oid_result in oids {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        let oid_str = oid.to_string();

        let lane = match lanes
            .iter()
            .position(|slot| slot.as_deref() == Some(oid_str.as_str()))
        {
            Some(idx) => idx,
            None => match lanes.iter().position(|slot| slot.is_none()) {
                Some(idx) => idx,
                None => {
                    lanes.push(None);
                    lanes.len() - 1
                }
            },
        };

        let parent_count = commit.parent_count();
        let mut edges = Vec::new();

        if parent_count == 0 {
            lanes[lane] = None;
        } else {
            for i in 0..parent_count {
                let parent_oid = commit.parent_id(i)?.to_string();
                if i == 0 {
                    lanes[lane] = Some(parent_oid.clone());
                    edges.push(GraphEdge {
                        parent_oid,
                        parent_lane: lane,
                    });
                } else {
                    let parent_lane = match lanes
                        .iter()
                        .position(|slot| slot.as_deref() == Some(parent_oid.as_str()))
                    {
                        Some(idx) => idx,
                        None => match lanes.iter().position(|slot| slot.is_none()) {
                            Some(idx) => {
                                lanes[idx] = Some(parent_oid.clone());
                                idx
                            }
                            None => {
                                lanes.push(Some(parent_oid.clone()));
                                lanes.len() - 1
                            }
                        },
                    };
                    edges.push(GraphEdge {
                        parent_oid,
                        parent_lane,
                    });
                }
            }
        }

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
    }

    Ok(out)
}

pub fn get_commit_graph(repo_path: &str, limit: usize) -> Result<Vec<GraphCommit>, AppError> {
    let repo = Repository::open(repo_path)?;
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    build_graph_commits(&repo, revwalk.take(limit))
}
```

Leave the `GraphEdge`/`GraphCommit` struct definitions (lines 1-22) and the entire `#[cfg(test)] mod tests` block untouched.

- [ ] **Step 2: Run the existing graph tests to confirm the refactor changed nothing**

Run: `cargo test --manifest-path src-tauri/Cargo.toml graph::`
Expected: all 6 existing tests (`graph_edge_serializes_with_camel_case_keys`, `graph_commit_serializes_with_camel_case_keys`, `linear_history_stays_in_single_lane`, `merge_commit_has_two_parent_edges`, `active_lanes_reflects_pass_through_lanes_in_a_branch_and_merge_history`, `respects_limit`) still PASS, unchanged.

---

### Task 2: `compare.rs` — symmetric-difference computation + Tauri command

**Files:**
- Create: `src-tauri/src/compare.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `graph::build_graph_commits` and `graph::GraphCommit` (Task 1).
- Produces: `pub fn compare_refs(repo_path: &str, base_ref: &str, compare_ref: &str) -> Result<CompareResult, AppError>`, and the `CommitSummary` / `CompareResult` structs — Task 3's frontend types mirror these field-for-field.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/compare.rs` with just the types, function signatures (unimplemented via `todo!()`), and this test module:

```rust
use crate::error::AppError;
use crate::graph::{build_graph_commits, GraphCommit};
use git2::{Repository, Sort};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareResult {
    pub base_oid: String,
    pub compare_oid: String,
    pub merge_base_oid: Option<String>,
    pub only_in_base: Vec<CommitSummary>,
    pub only_in_compare: Vec<CommitSummary>,
    pub graph: Vec<GraphCommit>,
}

pub fn compare_refs(_repo_path: &str, _base_ref: &str, _compare_ref: &str) -> Result<CompareResult, AppError> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::init_repo_with_commits;
    use git2::Signature;

    /// Adds one commit onto the existing "feature" branch (which
    /// `init_repo_with_commits` points at the shared root, one commit
    /// behind "main") so both branches have exactly one unique commit.
    fn add_feature_commit(repo: &Repository, dir: &std::path::Path) -> git2::Oid {
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        let feature_branch = repo.find_branch("feature", git2::BranchType::Local).unwrap();
        let parent = feature_branch.get().peel_to_commit().unwrap();

        std::fs::write(dir.join("c.txt"), "feature-only").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("c.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let oid = repo
            .commit(
                Some("refs/heads/feature"),
                &sig,
                &sig,
                "feature commit",
                &tree,
                &[&parent],
            )
            .unwrap();
        oid
    }

    #[test]
    fn compare_refs_finds_commits_unique_to_each_side() {
        let (dir, repo) = init_repo_with_commits();
        add_feature_commit(&repo, dir.path());

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "feature").unwrap();

        assert_eq!(result.only_in_base.len(), 1);
        assert_eq!(result.only_in_base[0].summary, "second commit");
        assert_eq!(result.only_in_compare.len(), 1);
        assert_eq!(result.only_in_compare[0].summary, "feature commit");
    }

    #[test]
    fn compare_refs_returns_empty_both_ways_for_identical_refs() {
        let (dir, _repo) = init_repo_with_commits();

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "main").unwrap();

        assert!(result.only_in_base.is_empty());
        assert!(result.only_in_compare.is_empty());
        assert_eq!(result.merge_base_oid, Some(result.base_oid.clone()));
    }

    #[test]
    fn compare_refs_handles_unrelated_histories_without_panicking() {
        let (dir, repo) = init_repo_with_commits();
        let sig = Signature::now("Test User", "test@example.com").unwrap();

        // An orphan commit (no parents) on its own ref — shares no history
        // with "main" at all.
        std::fs::write(dir.path().join("orphan.txt"), "orphan").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("orphan.txt")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let orphan_oid = repo.commit(None, &sig, &sig, "orphan root", &tree, &[]).unwrap();
        repo.reference("refs/heads/orphan", orphan_oid, true, "test orphan branch")
            .unwrap();

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "orphan").unwrap();

        assert_eq!(result.merge_base_oid, None);
        // No common ancestor to hide anything at, so each side's full
        // reachable history comes back.
        assert_eq!(result.only_in_base.len(), 2); // "second commit", "first commit"
        assert_eq!(result.only_in_compare.len(), 1); // "orphan root"
    }

    #[test]
    fn compare_refs_errors_when_a_ref_does_not_resolve() {
        let (dir, _repo) = init_repo_with_commits();

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "no-such-branch");

        assert!(result.is_err());
    }

    #[test]
    fn compare_refs_graph_field_covers_both_sides_with_distinct_lanes() {
        let (dir, repo) = init_repo_with_commits();
        add_feature_commit(&repo, dir.path());

        let result = compare_refs(dir.path().to_str().unwrap(), "main", "feature").unwrap();

        assert_eq!(result.graph.len(), 2);
        let summaries: Vec<&str> = result.graph.iter().map(|c| c.summary.as_str()).collect();
        assert!(summaries.contains(&"second commit"));
        assert!(summaries.contains(&"feature commit"));
        let lanes: std::collections::HashSet<usize> = result.graph.iter().map(|c| c.lane).collect();
        assert_eq!(lanes.len(), 2, "the two divergent commits must sit in different lanes");
    }
}
```

- [ ] **Step 2: Run to confirm the tests fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml compare::`
Expected: compile succeeds (the `todo!()` body type-checks), all 5 tests FAIL by panicking on `not yet implemented`.

- [ ] **Step 3: Implement `compare_refs`**

Replace the `todo!()` function with:

```rust
fn resolve_ref<'repo>(repo: &'repo Repository, ref_name: &str) -> Result<git2::Commit<'repo>, AppError> {
    let obj = repo
        .revparse_single(ref_name)
        .map_err(|_| AppError::Operation(format!("ref '{ref_name}' not found")))?;
    Ok(obj.peel_to_commit()?)
}

fn walk_summaries(
    repo: &Repository,
    tip: git2::Oid,
    hide: Option<git2::Oid>,
) -> Result<Vec<CommitSummary>, AppError> {
    let mut revwalk = repo.revwalk()?;
    revwalk.push(tip)?;
    if let Some(h) = hide {
        revwalk.hide(h)?;
    }
    revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;

    let mut out = Vec::new();
    for oid_result in revwalk {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;
        out.push(CommitSummary {
            oid: oid.to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
        });
    }
    Ok(out)
}

pub fn compare_refs(repo_path: &str, base_ref: &str, compare_ref: &str) -> Result<CompareResult, AppError> {
    let repo = Repository::open(repo_path)?;
    let base_commit = resolve_ref(&repo, base_ref)?;
    let compare_commit = resolve_ref(&repo, compare_ref)?;
    let base_oid = base_commit.id();
    let compare_oid = compare_commit.id();

    // `.ok()`, not `?` — two refs with unrelated histories are a legitimate
    // repo state (not an error): we just don't hide anything below, so each
    // side's full reachable history comes back instead of a bounded diff.
    let merge_base_oid = repo.merge_base(base_oid, compare_oid).ok();

    let only_in_base = walk_summaries(&repo, base_oid, merge_base_oid)?;
    let only_in_compare = walk_summaries(&repo, compare_oid, merge_base_oid)?;

    let mut combined_revwalk = repo.revwalk()?;
    combined_revwalk.push(base_oid)?;
    combined_revwalk.push(compare_oid)?;
    if let Some(mb) = merge_base_oid {
        combined_revwalk.hide(mb)?;
    }
    combined_revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    let graph = build_graph_commits(&repo, combined_revwalk)?;

    Ok(CompareResult {
        base_oid: base_oid.to_string(),
        compare_oid: compare_oid.to_string(),
        merge_base_oid: merge_base_oid.map(|o| o.to_string()),
        only_in_base,
        only_in_compare,
        graph,
    })
}
```

Remove the old `todo!()` stub (this replaces it, not adds alongside it).

- [ ] **Step 4: Run to confirm the tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml compare::`
Expected: all 5 tests PASS.

- [ ] **Step 5: Register the module and wire the Tauri command**

In `src-tauri/src/lib.rs`, add `mod compare;` next to the other `mod` declarations (after `mod pr_diff;`):

```rust
mod pr_diff;
mod compare;
mod commands;
```

In the same file, add `commands::compare_refs,` to the `generate_handler!` list (after `commands::checkout_tag,`):

```rust
            commands::switch_branch,
            commands::checkout_tag,
            commands::compare_refs,
        ])
```

In `src-tauri/src/commands.rs`, add the import (alongside the existing `use crate::pr_diff::{self, PrDiff};` line):

```rust
use crate::compare::{self, CompareResult};
```

And add the command function at the end of the file, after `checkout_tag`:

```rust
#[tauri::command]
pub async fn compare_refs(repo_path: String, base_ref: String, compare_ref: String) -> Result<CompareResult, AppError> {
    run_blocking(move || compare::compare_refs(&repo_path, &base_ref, &compare_ref)).await
}
```

- [ ] **Step 6: Run the full backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass (previous count + the 5 new `compare::` tests), zero failures.

---

### Task 3: Frontend types, invoke wrapper, and `compareStore`

**Files:**
- Modify: `src/lib/tauri.ts`
- Create: `src/store/compareStore.ts`
- Test: `src/__tests__/compareStore.test.ts`

**Interfaces:**
- Consumes: `invoke` from `@tauri-apps/api/core` (existing pattern), the `compare_refs` Tauri command (Task 2).
- Produces: `useCompareStore` with `{ baseRef, compareRef, result, isLoading, error, setBaseRef, setCompareRef, loadCompare }` — Task 6's `CompareScreen` consumes this exact shape. `CompareResult`/`CommitSummary` TS types — Tasks 6-9 all import these.

- [ ] **Step 1: Add the TS types and invoke wrapper**

In `src/lib/tauri.ts`, add after the existing `PrReviewComment` interface / `invokeAddPrReviewComment` block (end of file):

```ts
export interface CommitSummary {
  oid: string;
  summary: string;
  author: string;
  timestamp: number;
}

export interface CompareResult {
  baseOid: string;
  compareOid: string;
  mergeBaseOid: string | null;
  onlyInBase: CommitSummary[];
  onlyInCompare: CommitSummary[];
  graph: GraphCommit[];
}

export const invokeCompareRefs = (repoPath: string, baseRef: string, compareRef: string) =>
  invoke<CompareResult>("compare_refs", { repoPath, baseRef, compareRef });
```

- [ ] **Step 2: Write the failing store tests**

Create `src/__tests__/compareStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeCompareRefs: vi.fn(),
}));

import { useCompareStore } from "../store/compareStore";
import * as tauriLib from "../lib/tauri";

describe("compareStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompareStore.setState({
      baseRef: null,
      compareRef: null,
      result: null,
      isLoading: false,
      error: null,
    });
  });

  it("defaults to no refs picked and no result", () => {
    const state = useCompareStore.getState();
    expect(state.baseRef).toBeNull();
    expect(state.compareRef).toBeNull();
    expect(state.result).toBeNull();
  });

  it("setBaseRef and setCompareRef update the picked refs", () => {
    useCompareStore.getState().setBaseRef("v1.0");
    useCompareStore.getState().setCompareRef("v2.0");
    expect(useCompareStore.getState().baseRef).toBe("v1.0");
    expect(useCompareStore.getState().compareRef).toBe("v2.0");
  });

  it("loadCompare does nothing until both refs are picked", async () => {
    useCompareStore.setState({ baseRef: "v1.0", compareRef: null });
    await useCompareStore.getState().loadCompare("/tmp/a");
    expect(tauriLib.invokeCompareRefs).not.toHaveBeenCalled();
  });

  it("loadCompare fetches and stores the result once both refs are set", async () => {
    const sampleResult = {
      baseOid: "b",
      compareOid: "c",
      mergeBaseOid: "m",
      onlyInBase: [],
      onlyInCompare: [{ oid: "c1", summary: "new work", author: "a", timestamp: 100 }],
      graph: [],
    };
    (tauriLib.invokeCompareRefs as any).mockResolvedValue(sampleResult);
    useCompareStore.setState({ baseRef: "v1.0", compareRef: "v2.0" });

    await useCompareStore.getState().loadCompare("/tmp/a");

    expect(tauriLib.invokeCompareRefs).toHaveBeenCalledWith("/tmp/a", "v1.0", "v2.0");
    expect(useCompareStore.getState().result).toEqual(sampleResult);
  });

  it("sets isLoading while the request is in flight", async () => {
    let resolveFn: (value: any) => void;
    (tauriLib.invokeCompareRefs as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    useCompareStore.setState({ baseRef: "v1.0", compareRef: "v2.0" });

    const promise = useCompareStore.getState().loadCompare("/tmp/a");
    expect(useCompareStore.getState().isLoading).toBe(true);
    resolveFn!({ baseOid: "b", compareOid: "c", mergeBaseOid: null, onlyInBase: [], onlyInCompare: [], graph: [] });
    await promise;
    expect(useCompareStore.getState().isLoading).toBe(false);
  });

  it("stores an error message and clears any prior result on failure", async () => {
    (tauriLib.invokeCompareRefs as any).mockRejectedValue("ref 'v9.9' not found");
    useCompareStore.setState({ baseRef: "v1.0", compareRef: "v9.9" });

    await useCompareStore.getState().loadCompare("/tmp/a");

    expect(useCompareStore.getState().error).toBe("ref 'v9.9' not found");
    expect(useCompareStore.getState().result).toBeNull();
  });
});
```

- [ ] **Step 3: Run to confirm the tests fail**

Run: `npx vitest run src/__tests__/compareStore.test.ts`
Expected: FAIL — `Cannot find module '../store/compareStore'`.

- [ ] **Step 4: Implement `compareStore.ts`**

Create `src/store/compareStore.ts`:

```ts
import { create } from "zustand";
import { invokeCompareRefs, type CompareResult } from "../lib/tauri";

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

export const useCompareStore = create<CompareState>((set, get) => ({
  baseRef: null,
  compareRef: null,
  result: null,
  isLoading: false,
  error: null,
  setBaseRef: (baseRef) => set({ baseRef }),
  setCompareRef: (compareRef) => set({ compareRef }),
  loadCompare: async (repoPath: string) => {
    const { baseRef, compareRef } = get();
    if (!baseRef || !compareRef) return;
    set({ isLoading: true, error: null });
    try {
      const result = await invokeCompareRefs(repoPath, baseRef, compareRef);
      set({ result });
    } catch (e) {
      set({ error: String(e), result: null });
    } finally {
      set({ isLoading: false });
    }
  },
}));
```

- [ ] **Step 5: Run to confirm the tests pass**

Run: `npx vitest run src/__tests__/compareStore.test.ts`
Expected: all 6 tests PASS.

---

### Task 4: `RefCombobox` component

**Files:**
- Create: `src/components/RefCombobox.tsx`
- Test: `src/__tests__/RefCombobox.test.tsx`

**Interfaces:**
- Consumes: `rankMatches` from `../lib/fuzzyMatch` (existing).
- Produces: `<RefCombobox value: string | null, onChange: (value: string) => void, branches: string[], tags: string[], placeholder?: string />` — Task 6's `CompareScreen` renders two of these.

This is a new component (not a modification of `BranchCombobox`), so the existing PR branch-filter picker can't regress. Unlike `BranchCombobox`, there is no "Any" option — Compare always needs two concrete refs — so `onChange` never receives `null`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/RefCombobox.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RefCombobox from "../components/RefCombobox";

describe("RefCombobox", () => {
  const branches = ["main", "develop"];
  const tags = ["v1.0.0", "v2.0.0"];

  it("shows the placeholder when nothing is picked", () => {
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={tags} placeholder="Base ref" />);
    expect(screen.getByText("Base ref")).toBeInTheDocument();
  });

  it("shows the picked value on the trigger button", () => {
    render(<RefCombobox value="main" onChange={vi.fn()} branches={branches} tags={tags} />);
    expect(screen.getByRole("button", { name: "main" })).toBeInTheDocument();
  });

  it("opens to show Branches and Tags sections", () => {
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    expect(screen.getByText("Branches")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
  });

  it("filters both branches and tags by typed text", () => {
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.change(screen.getByPlaceholderText("Jump to branch or tag..."), { target: { value: "v2" } });
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
    expect(screen.queryByText("v1.0.0")).not.toBeInTheDocument();
  });

  it("calls onChange and closes when a branch row is clicked", () => {
    const onChange = vi.fn();
    render(<RefCombobox value={null} onChange={onChange} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.click(screen.getByText("develop"));
    expect(onChange).toHaveBeenCalledWith("develop");
    expect(screen.queryByText("Branches")).not.toBeInTheDocument();
  });

  it("calls onChange when a tag row is clicked", () => {
    const onChange = vi.fn();
    render(<RefCombobox value={null} onChange={onChange} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.click(screen.getByText("v1.0.0"));
    expect(onChange).toHaveBeenCalledWith("v1.0.0");
  });

  it("selects the highlighted row on Enter", () => {
    const onChange = vi.fn();
    render(<RefCombobox value={null} onChange={onChange} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    const input = screen.getByPlaceholderText("Jump to branch or tag...");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("main");
  });

  it("closes on Escape without calling onChange", () => {
    const onChange = vi.fn();
    render(<RefCombobox value={null} onChange={onChange} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.keyDown(screen.getByPlaceholderText("Jump to branch or tag..."), { key: "Escape" });
    expect(screen.queryByText("Branches")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a no-matches message when nothing matches the filter", () => {
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.change(screen.getByPlaceholderText("Jump to branch or tag..."), { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm the tests fail**

Run: `npx vitest run src/__tests__/RefCombobox.test.tsx`
Expected: FAIL — `Cannot find module '../components/RefCombobox'`.

- [ ] **Step 3: Implement `RefCombobox.tsx`**

Create `src/components/RefCombobox.tsx`:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { rankMatches } from "../lib/fuzzyMatch";

interface RefComboboxProps {
  value: string | null;
  onChange: (value: string) => void;
  branches: string[];
  tags: string[];
  placeholder?: string;
}

export default function RefCombobox({ value, onChange, branches, tags, placeholder }: RefComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredBranches = rankMatches(filterText, branches, (b) => b);
  const filteredTags = rankMatches(filterText, tags, (t) => t);
  const rows: string[] = [...filteredBranches, ...filteredTags];

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setFilterText("");
      setHighlightedIndex(0);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const selectRow = (row: string) => {
    onChange(row);
    setIsOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[highlightedIndex]) selectRow(rows[highlightedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={value ?? placeholder ?? "Select ref"}
        className="w-40 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary text-left truncate flex items-center gap-1.5"
        onClick={() => setIsOpen((o) => !o)}
      >
        <span className="truncate">{value ?? placeholder ?? "Select..."}</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-64 bg-elevated border border-border-subtle rounded-lg shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
            <Search size={13} className="text-accent shrink-0" />
            <input
              ref={inputRef}
              className="w-full bg-transparent outline-none text-text-primary text-sm"
              placeholder="Jump to branch or tag..."
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredBranches.length > 0 && (
              <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-text-muted">Branches</div>
            )}
            {filteredBranches.map((row, idx) => (
              <div
                key={`branch-${row}`}
                data-ref-row
                onClick={() => selectRow(row)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary ${
                  idx === highlightedIndex ? "bg-accent-soft" : ""
                }`}
              >
                <span className="truncate flex-1">{row}</span>
                {row === value && (
                  <span className="text-[10px] uppercase tracking-wide text-text-muted bg-hover border border-border-subtle rounded px-1 py-0.5 shrink-0">
                    current
                  </span>
                )}
              </div>
            ))}
            {filteredTags.length > 0 && (
              <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-muted">Tags</div>
            )}
            {filteredTags.map((row, idx) => {
              const rowIndex = filteredBranches.length + idx;
              return (
                <div
                  key={`tag-${row}`}
                  data-ref-row
                  onClick={() => selectRow(row)}
                  onMouseEnter={() => setHighlightedIndex(rowIndex)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary ${
                    rowIndex === highlightedIndex ? "bg-accent-soft" : ""
                  }`}
                >
                  <span className="truncate flex-1">{row}</span>
                  {row === value && (
                    <span className="text-[10px] uppercase tracking-wide text-text-muted bg-hover border border-border-subtle rounded px-1 py-0.5 shrink-0">
                      current
                    </span>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && <div className="px-2 py-3 text-xs text-text-muted text-center">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm the tests pass**

Run: `npx vitest run src/__tests__/RefCombobox.test.tsx`
Expected: all 9 tests PASS.

---

### Task 5: "Compare" tab in the sidebar

**Files:**
- Modify: `src/store/viewStore.ts`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/__tests__/Sidebar.test.tsx`

**Interfaces:**
- Produces: `ActiveView` gains `"compare"` — Task 6's `App.tsx` wiring and `CompareScreen` mounting depend on this value existing.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/Sidebar.test.tsx`, add this test after `"switches back to repo when the Repo tab is clicked"`:

```tsx
  it("switches to compare when the Compare tab is clicked", () => {
    render(<Sidebar />);
    screen.getByRole("button", { name: "Compare" }).click();
    expect(useViewStore.getState().activeView).toBe("compare");
  });
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: FAIL — no button named "Compare" exists yet.

- [ ] **Step 3: Add the `"compare"` view and the tab button**

In `src/store/viewStore.ts`, change:

```ts
export type ActiveView = "repo" | "pulls";
```

to:

```ts
export type ActiveView = "repo" | "pulls" | "compare";
```

In `src/components/Sidebar.tsx`, add a third button after the "Pull Requests" button (inside the same `flex items-center gap-1 p-2 border-b border-border-subtle` row):

```tsx
        <button
          type="button"
          className={`flex-1 text-xs px-2 py-1 rounded ${
            activeView === "compare" ? "bg-accent text-accent-contrast" : "bg-elevated border border-border-subtle text-text-primary"
          }`}
          onClick={() => setActiveView("compare")}
        >
          Compare
        </button>
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: all tests PASS (existing 4 + the 1 new one = 5).

---

### Task 6: `CompareScreen` shell — pickers, direction toggle, view-mode switcher, empty/error states

**Files:**
- Create: `src/components/CompareScreen.tsx`
- Modify: `src/App.tsx`
- Modify: `src/__tests__/App.test.tsx`
- Test: `src/__tests__/CompareScreen.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaceStore` (`activeRepoId`, `repos`, `branches`, `tags` — all already populated on repo activation, no new fetch), `useCompareStore` (Task 3), `RefCombobox` (Task 4).
- Produces: `<CompareScreen />`, mounted by `App.tsx` when `activeView === "compare"`. Renders `CompareTable`/`CompareGraph`/`CompareTimeline` — stubbed as trivial placeholders in this task, replaced with real implementations in Tasks 7-9 (each of which only changes its own file, not `CompareScreen.tsx`, since the props contract is fixed here).

This task also intentionally scopes the global `SearchBar` (commit message/code search — meaningless on the Compare screen) to the Repo tab only, changing `{activeView !== "pulls" && <SearchBar />}` to `{activeView === "repo" && <SearchBar />}`.

- [ ] **Step 1: Write the failing tests**

Create placeholder components first so `CompareScreen` has something to import (these get replaced in Tasks 7-9 — the placeholders exist only so this task's tests can assert on `CompareScreen`'s own behavior in isolation via mocks, same pattern as `App.test.tsx` mocking `CommitGraph`):

Create `src/components/CompareTable.tsx`:
```tsx
export default function CompareTable() {
  return <div data-testid="compare-table" />;
}
```

Create `src/components/CompareGraph.tsx`:
```tsx
export default function CompareGraph() {
  return <div data-testid="compare-graph" />;
}
```

Create `src/components/CompareTimeline.tsx`:
```tsx
export default function CompareTimeline() {
  return <div data-testid="compare-timeline" />;
}
```

Create `src/__tests__/CompareScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useCompareStore } from "../store/compareStore";

vi.mock("../components/CompareTable", () => ({ default: () => <div data-testid="compare-table" /> }));
vi.mock("../components/CompareGraph", () => ({ default: () => <div data-testid="compare-graph" /> }));
vi.mock("../components/CompareTimeline", () => ({ default: () => <div data-testid="compare-timeline" /> }));

import CompareScreen from "../components/CompareScreen";

const sampleResult = {
  baseOid: "b",
  compareOid: "c",
  mergeBaseOid: "m",
  onlyInBase: [],
  onlyInCompare: [{ oid: "c1", summary: "new work", author: "a", timestamp: 100 }],
  graph: [],
};

describe("CompareScreen", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "abc" }],
      tags: [{ name: "v1.0.0", targetOid: "abc" }],
    });
    useCompareStore.setState({ baseRef: null, compareRef: null, result: null, isLoading: false, error: null });
  });

  it("shows a prompt to pick two refs before anything is selected", () => {
    render(<CompareScreen />);
    expect(screen.getByText("Pick two refs to compare.")).toBeInTheDocument();
  });

  it("renders the base and compare ref pickers", () => {
    render(<CompareScreen />);
    expect(screen.getByRole("button", { name: "Base ref" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare ref" })).toBeInTheDocument();
  });

  it("shows a loading state while the comparison is in flight", () => {
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main", isLoading: true });
    render(<CompareScreen />);
    expect(screen.getByText("Comparing…")).toBeInTheDocument();
  });

  it("shows an error message when the store has an error", () => {
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main", error: "ref 'x' not found" });
    render(<CompareScreen />);
    expect(screen.getByText("ref 'x' not found")).toBeInTheDocument();
  });

  it("shows an identical-refs empty state when both result lists are empty", () => {
    useCompareStore.setState({
      baseRef: "v1.0.0",
      compareRef: "main",
      result: { baseOid: "b", compareOid: "b", mergeBaseOid: "b", onlyInBase: [], onlyInCompare: [], graph: [] },
    });
    render(<CompareScreen />);
    expect(screen.getByText("Identical — no differences")).toBeInTheDocument();
  });

  it("renders the Table view by default once a result is loaded", () => {
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main", result: sampleResult });
    render(<CompareScreen />);
    expect(screen.getByTestId("compare-table")).toBeInTheDocument();
  });

  it("switches to the Graph view when the Graph button is clicked", () => {
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main", result: sampleResult });
    render(<CompareScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(screen.getByTestId("compare-graph")).toBeInTheDocument();
    expect(screen.queryByTestId("compare-table")).not.toBeInTheDocument();
  });

  it("switches to the Timeline view when the Timeline button is clicked", () => {
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main", result: sampleResult });
    render(<CompareScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(screen.getByTestId("compare-timeline")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm the tests fail**

Run: `npx vitest run src/__tests__/CompareScreen.test.tsx`
Expected: FAIL — `Cannot find module '../components/CompareScreen'`.

- [ ] **Step 3: Implement `CompareScreen.tsx`**

Create `src/components/CompareScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useCompareStore } from "../store/compareStore";
import RefCombobox from "./RefCombobox";
import CompareTable from "./CompareTable";
import CompareGraph from "./CompareGraph";
import CompareTimeline from "./CompareTimeline";

type ViewMode = "table" | "graph" | "timeline";
export type CompareDirection = "new-only" | "both";

export default function CompareScreen() {
  const { activeRepoId, repos, branches, tags } = useWorkspaceStore();
  const { baseRef, compareRef, result, isLoading, error, setBaseRef, setCompareRef, loadCompare } = useCompareStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [direction, setDirection] = useState<CompareDirection>("both");

  const branchNames = branches.map((b) => b.name);
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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle flex-wrap">
        <RefCombobox value={baseRef} onChange={setBaseRef} branches={branchNames} tags={tagNames} placeholder="Base ref" />
        <span className="text-text-muted text-xs">compared to</span>
        <RefCombobox value={compareRef} onChange={setCompareRef} branches={branchNames} tags={tagNames} placeholder="Compare ref" />
        <div className="flex-1" />
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
      <div className="flex-1 overflow-y-auto">
        {!baseRef || !compareRef ? (
          <div className="p-6 text-sm text-text-muted text-center">Pick two refs to compare.</div>
        ) : isLoading ? (
          <div className="p-6 text-sm text-text-muted text-center">Comparing…</div>
        ) : error ? (
          <div className="p-6 text-sm text-danger text-center">{error}</div>
        ) : identical ? (
          <div className="p-6 text-sm text-text-muted text-center">Identical — no differences</div>
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
```

- [ ] **Step 4: Run to confirm the tests pass**

Run: `npx vitest run src/__tests__/CompareScreen.test.tsx`
Expected: all 8 tests PASS. (The placeholder `CompareTable`/`CompareGraph`/`CompareTimeline` components render but ignore their props — that's fine, this task only tests `CompareScreen`'s own switching/empty-state logic.)

- [ ] **Step 5: Wire `App.tsx` and scope the search bar to the Repo tab**

In `src/App.tsx`, add the import:

```tsx
import CompareScreen from "./components/CompareScreen";
```

Change:

```tsx
      {activeView !== "pulls" && <SearchBar />}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        {activeView === "pulls" ? (
          <PullRequestsScreen />
        ) : isSearchActive ? (
```

to:

```tsx
      {activeView === "repo" && <SearchBar />}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        {activeView === "pulls" ? (
          <PullRequestsScreen />
        ) : activeView === "compare" ? (
          <CompareScreen />
        ) : isSearchActive ? (
```

- [ ] **Step 6: Update `App.test.tsx`**

In `src/__tests__/App.test.tsx`, add the mock (alongside the other `vi.mock` calls):

```tsx
vi.mock("../components/CompareScreen", () => ({ default: () => <div data-testid="compare-screen" /> }));
```

Add these two tests at the end of the `describe` block:

```tsx
  it("shows the Compare screen instead of the repo view when activeView is compare", () => {
    useViewStore.setState({ activeView: "compare" });
    render(<App />);
    expect(screen.getByTestId("compare-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("commit-graph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pull-requests-screen")).not.toBeInTheDocument();
  });

  it("hides the global search bar in the Compare view", () => {
    useViewStore.setState({ activeView: "compare" });
    render(<App />);
    expect(screen.queryByTestId("search-bar")).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Run the full frontend suite**

Run: `npx vitest run`
Expected: all tests pass (previous count + new tests across Tasks 3-6), zero failures other than the pre-existing unrelated `Toolbar.test.tsx` "Push" failure (tracked separately, not part of this feature).

---

### Task 7: `CompareTable` (Table view)

**Files:**
- Modify: `src/components/CompareTable.tsx` (replace Task 6's placeholder)
- Create: `src/__tests__/CompareTable.test.tsx`

**Interfaces:**
- Consumes: `CompareResult`/`CommitSummary` types (Task 3), `CommitGraphRow` (existing, `showGraphLines={false}` branch only touches `oid`/`summary`/`author`/`timestamp` — confirmed by reading its source, so zero-filled `lane`/`edges`/`activeLanes` are safe).
- Produces: `<CompareTable result, baseRef, compareRef, direction />` exactly matching the props `CompareScreen` (Task 6) already passes.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/CompareTable.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareTable from "../components/CompareTable";

const result = {
  baseOid: "b",
  compareOid: "c",
  mergeBaseOid: "m",
  onlyInBase: [{ oid: "b1", summary: "old-side commit", author: "avery", timestamp: 100 }],
  onlyInCompare: [{ oid: "c1", summary: "new-side commit", author: "yarinmag", timestamp: 200 }],
  graph: [],
};

describe("CompareTable", () => {
  it("shows both sections and their commits when direction is both", () => {
    render(<CompareTable result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    expect(screen.getByText("Only in v2.0.0")).toBeInTheDocument();
    expect(screen.getByText("new-side commit")).toBeInTheDocument();
    expect(screen.getByText("Only in v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("old-side commit")).toBeInTheDocument();
  });

  it("hides the base section when direction is new-only", () => {
    render(<CompareTable result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="new-only" />);
    expect(screen.getByText("new-side commit")).toBeInTheDocument();
    expect(screen.queryByText("Only in v1.0.0")).not.toBeInTheDocument();
    expect(screen.queryByText("old-side commit")).not.toBeInTheDocument();
  });

  it("shows a no-unique-commits message for an empty side", () => {
    const oneSided = { ...result, onlyInBase: [] };
    render(<CompareTable result={oneSided as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    expect(screen.getByText("No unique commits")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm the tests fail**

Run: `npx vitest run src/__tests__/CompareTable.test.tsx`
Expected: FAIL — the placeholder `CompareTable` renders none of the expected text.

- [ ] **Step 3: Implement `CompareTable.tsx`**

Replace the full contents of `src/components/CompareTable.tsx`:

```tsx
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
```

- [ ] **Step 4: Run to confirm the tests pass**

Run: `npx vitest run src/__tests__/CompareTable.test.tsx`
Expected: all 3 tests PASS.

---

### Task 8: `CompareGraph` (Graph view)

**Files:**
- Modify: `src/components/CompareGraph.tsx` (replace Task 6's placeholder)
- Create: `src/__tests__/CompareGraph.test.tsx`

**Interfaces:**
- Consumes: `CompareResult` (Task 3), `CommitGraphRow` (existing, `showGraphLines={true}` branch, same usage pattern as `CommitGraph.tsx`).
- Produces: `<CompareGraph result, direction />` matching what `CompareScreen` (Task 6) passes.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/CompareGraph.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareGraph from "../components/CompareGraph";

const result = {
  baseOid: "b",
  compareOid: "c",
  mergeBaseOid: "m",
  onlyInBase: [{ oid: "b1", summary: "old-side commit", author: "avery", timestamp: 100 }],
  onlyInCompare: [{ oid: "c1", summary: "new-side commit", author: "yarinmag", timestamp: 200 }],
  graph: [
    { oid: "c1", summary: "new-side commit", author: "yarinmag", timestamp: 200, lane: 1, edges: [], activeLanes: [true, true] },
    { oid: "b1", summary: "old-side commit", author: "avery", timestamp: 100, lane: 0, edges: [], activeLanes: [true, false] },
  ],
};

describe("CompareGraph", () => {
  it("renders every commit in the combined graph when direction is both", () => {
    render(<CompareGraph result={result as any} direction="both" />);
    expect(screen.getAllByTestId("commit-row")).toHaveLength(2);
    expect(screen.getByText("new-side commit")).toBeInTheDocument();
    expect(screen.getByText("old-side commit")).toBeInTheDocument();
  });

  it("only renders compare-side commits when direction is new-only", () => {
    render(<CompareGraph result={result as any} direction="new-only" />);
    expect(screen.getAllByTestId("commit-row")).toHaveLength(1);
    expect(screen.getByText("new-side commit")).toBeInTheDocument();
    expect(screen.queryByText("old-side commit")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm the tests fail**

Run: `npx vitest run src/__tests__/CompareGraph.test.tsx`
Expected: FAIL — the placeholder `CompareGraph` renders none of the expected rows.

- [ ] **Step 3: Implement `CompareGraph.tsx`**

Replace the full contents of `src/components/CompareGraph.tsx`:

```tsx
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
```

- [ ] **Step 4: Run to confirm the tests pass**

Run: `npx vitest run src/__tests__/CompareGraph.test.tsx`
Expected: both tests PASS.

---

### Task 9: `CompareTimeline` (Timeline view)

**Files:**
- Modify: `src/components/CompareTimeline.tsx` (replace Task 6's placeholder)
- Create: `src/__tests__/CompareTimeline.test.tsx`

**Interfaces:**
- Consumes: `CompareResult`/`CommitSummary` (Task 3), `initials` from `../lib/prDisplay` (existing), `hashHue` from `../lib/hashColor` (existing).
- Produces: `<CompareTimeline result, baseRef, compareRef, direction />` matching what `CompareScreen` (Task 6) passes.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/CompareTimeline.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareTimeline from "../components/CompareTimeline";

const result = {
  baseOid: "b",
  compareOid: "c",
  mergeBaseOid: "m",
  onlyInBase: [{ oid: "b1", summary: "old-side commit", author: "avery", timestamp: 100 }],
  onlyInCompare: [
    { oid: "c1", summary: "newer commit", author: "yarinmag", timestamp: 300 },
    { oid: "c2", summary: "older new-side commit", author: "yarinmag", timestamp: 200 },
  ],
  graph: [],
};

describe("CompareTimeline", () => {
  it("shows both columns with their titles and commits when direction is both", () => {
    render(<CompareTimeline result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    expect(screen.getByText("Only in v2.0.0")).toBeInTheDocument();
    expect(screen.getByText("newer commit")).toBeInTheDocument();
    expect(screen.getByText("older new-side commit")).toBeInTheDocument();
    expect(screen.getByText("Only in v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("old-side commit")).toBeInTheDocument();
  });

  it("hides the base column when direction is new-only", () => {
    render(<CompareTimeline result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="new-only" />);
    expect(screen.queryByText("Only in v1.0.0")).not.toBeInTheDocument();
    expect(screen.queryByText("old-side commit")).not.toBeInTheDocument();
  });

  it("sorts each column by timestamp, newest first", () => {
    render(<CompareTimeline result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    const summaries = screen.getAllByText(/commit$/).map((el) => el.textContent);
    const newerIdx = summaries.indexOf("newer commit");
    const olderIdx = summaries.indexOf("older new-side commit");
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("shows a no-unique-commits message for an empty column", () => {
    const oneSided = { ...result, onlyInBase: [] };
    render(<CompareTimeline result={oneSided as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    expect(screen.getByText("No unique commits")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm the tests fail**

Run: `npx vitest run src/__tests__/CompareTimeline.test.tsx`
Expected: FAIL — the placeholder `CompareTimeline` renders none of the expected text.

- [ ] **Step 3: Implement `CompareTimeline.tsx`**

Replace the full contents of `src/components/CompareTimeline.tsx`:

```tsx
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
```

- [ ] **Step 4: Run to confirm the tests pass**

Run: `npx vitest run src/__tests__/CompareTimeline.test.tsx`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the full frontend and backend suites**

Run: `npx vitest run`
Expected: all tests pass, zero failures other than the pre-existing unrelated `Toolbar.test.tsx` "Push" failure.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass.

- [ ] **Step 6: Visual verification**

Following this project's established pattern (Playwright against `npm run dev` with a mocked `window.__TAURI_INTERNALS__.invoke`, screenshots reviewed, temp files and dev server cleaned up afterward): mock `get_branches`/`get_tags`/`compare_refs` for a repo with two diverging refs, open the Compare tab, and screenshot all three view modes (Table, Graph, Timeline) plus the "New only" vs "Both directions" toggle and the identical-refs empty state, to confirm the layout reads cleanly before calling this feature done.

**No commit** — this project is not git-tracked (see Global Constraints).
