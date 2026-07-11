# Bettertree Branch Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-click a branch row in the sidebar to check it out — local branches switch directly, remote branches create-and-track a local branch first (or reuse an existing same-named one), and the switch is blocked with a clear error if the working tree has uncommitted changes.

**Architecture:** A new `branch.rs` module owns the checkout logic, reusing `workdir::get_status` for the dirty-tree check rather than duplicating status logic. The Tauri command follows the existing thin-wrapper pattern in `commands.rs`. On the frontend, the branches/tags/commits refresh logic currently inlined in `workspaceStore.setActiveRepo` is extracted into a shared helper so `switchBranch` can reuse it.

**Tech Stack:** Same as the rest of the project — Tauri v2, Rust, git2, React 18, TypeScript, Zustand.

**Relationship to spec:** Implements `docs/superpowers/specs/2026-07-06-bettertree-branch-switching.md` in full.

## Global Constraints

- No git version control for this project — no commits. Every task's last step is "mark task complete."
- No forced/destructive checkout — a dirty working tree always blocks the switch with an error, never silently discards changes.
- Tag checkout and detached HEAD are explicitly out of scope.
- Every Rust struct returned to the frontend needs `#[serde(rename_all = "camelCase")]` if it has any multi-word field (established rule from earlier plans — this feature returns `Result<(), AppError>` only, so it doesn't apply here, but keep it in mind if this ever grows a return payload).
- Full regression (`cargo test`, `npm test`, `npm run e2e`) at the end of the last task.

---

## File Structure

```
bettertree/
  src-tauri/src/
    branch.rs              # NEW: switch_branch (local + remote checkout logic)
    commands.rs               # MODIFY: wire switch_branch command
    lib.rs                       # MODIFY: register branch module + command
  src/
    lib/tauri.ts                  # MODIFY: invokeSwitchBranch
    store/workspaceStore.ts          # MODIFY: extract refresh helper, add switchBranch
    components/BranchTree.tsx           # MODIFY: double-click + inline error
    __tests__/BranchTree.test.tsx          # MODIFY: add double-click tests
```

`branch.rs` never touches SQLite or the working-copy staging logic — it only resolves refs and calls `git2` checkout, delegating the dirty-check to `workdir.rs` rather than re-implementing status logic.

---

### Task 1: Branch checkout logic

**Files:**
- Create: `src-tauri/src/branch.rs`

**Interfaces:**
- Consumes: `workdir::get_status` (existing, from Plan 3), `AppError::Operation` (existing, from Plan 3), `test_support::{init_repo_with_commits, init_repo_with_remote}` (tests only), `remote::fetch`/`remote::push` (tests only, to populate remote-tracking refs).
- Produces: `switch_branch(repo_path: &str, branch_name: &str, is_remote: bool) -> Result<(), AppError>`. Task 2's Tauri command calls this by this exact name and signature.

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/branch.rs` (tests only for now):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote;
    use crate::test_support::{init_repo_with_commits, init_repo_with_remote};
    use std::path::Path;

    #[test]
    fn switches_to_an_existing_local_branch() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();

        switch_branch(repo_path, "feature", false).unwrap();

        assert_eq!(repo.head().unwrap().shorthand().unwrap(), "feature");
    }

    #[test]
    fn blocks_switch_when_working_tree_is_dirty() {
        let (dir, _repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        std::fs::write(dir.path().join("a.txt"), "modified but not staged").unwrap();

        let result = switch_branch(repo_path, "feature", false);

        assert!(result.is_err());
    }

    #[test]
    fn remote_branch_with_no_local_counterpart_creates_and_tracks_one() {
        let (local_dir, _bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();

        // Push local "feature" to the remote under a different name, then
        // fetch, so refs/remotes/origin/other-branch exists with no local
        // "other-branch" counterpart.
        let feature_branch = local_repo.find_branch("feature", git2::BranchType::Local).unwrap();
        let feature_oid = feature_branch.get().target().unwrap();
        let mut remote_conn = local_repo.find_remote("origin").unwrap();
        let refspec = format!("{}:refs/heads/other-branch", feature_branch.get().name().unwrap());
        remote_conn.push(&[&refspec], None).unwrap();
        remote::fetch(repo_path, "origin").unwrap();

        switch_branch(repo_path, "origin/other-branch", true).unwrap();

        assert_eq!(local_repo.head().unwrap().shorthand().unwrap(), "other-branch");
        assert_eq!(local_repo.head().unwrap().target().unwrap(), feature_oid);
        let new_branch = local_repo.find_branch("other-branch", git2::BranchType::Local).unwrap();
        assert_eq!(new_branch.upstream().unwrap().name().unwrap().unwrap(), "origin/other-branch");
    }

    #[test]
    fn remote_branch_with_existing_local_counterpart_just_switches() {
        let (local_dir, _bare_dir, local_repo) = init_repo_with_remote();
        let repo_path = local_dir.path().to_str().unwrap();
        remote::push(repo_path, "origin").unwrap();
        remote::fetch(repo_path, "origin").unwrap();

        switch_branch(repo_path, "origin/main", true).unwrap();

        assert_eq!(local_repo.head().unwrap().shorthand().unwrap(), "main");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml branch::tests`
Expected: FAIL to compile — `switch_branch` not defined.

- [ ] **Step 3: Write the implementation**

Prepend this to `src-tauri/src/branch.rs` (above the `#[cfg(test)]` block):

```rust
use crate::error::AppError;
use crate::workdir;
use git2::build::CheckoutBuilder;
use git2::Repository;

pub fn switch_branch(repo_path: &str, branch_name: &str, is_remote: bool) -> Result<(), AppError> {
    let status = workdir::get_status(repo_path)?;
    if !status.is_empty() {
        return Err(AppError::Operation(
            "cannot switch branches with uncommitted changes".into(),
        ));
    }

    let repo = Repository::open(repo_path)?;

    let local_branch_name = if is_remote {
        branch_name.splitn(2, '/').nth(1).unwrap_or(branch_name).to_string()
    } else {
        branch_name.to_string()
    };
    let local_ref_name = format!("refs/heads/{local_branch_name}");

    if is_remote && repo.find_reference(&local_ref_name).is_err() {
        let remote_branch = repo.find_branch(branch_name, git2::BranchType::Remote)?;
        let remote_commit = remote_branch.get().peel_to_commit()?;
        let mut new_branch = repo.branch(&local_branch_name, &remote_commit, false)?;
        new_branch.set_upstream(Some(branch_name))?;
    }

    let obj = repo.revparse_single(&local_ref_name)?;
    repo.checkout_tree(&obj, Some(&mut CheckoutBuilder::new()))?;
    repo.set_head(&local_ref_name)?;
    Ok(())
}
```

(`CheckoutBuilder::new()` defaults to git2's Safe checkout strategy — no `.force()` is called — so it also refuses to overwrite anything our own `get_status` pre-check might have missed)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml branch::tests`
Expected: `test result: ok. 4 passed; 0 failed`

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests from every prior plan pass, plus this task's 4 new ones.

- [ ] **Step 6: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 2: Tauri command wiring

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `branch::switch_branch` (Task 1).
- Produces: Tauri command `switch_branch(repo_path: String, branch_name: String, is_remote: bool) -> Result<(), AppError>`. Task 3's `src/lib/tauri.ts` calls this by this exact name.

No new unit test — thin wiring over an already-tested function, verified via the full backend suite.

- [ ] **Step 1: Add the command**

Modify `src-tauri/src/commands.rs` — add the import alongside the existing ones at the top:

```rust
use crate::branch;
```

Add the command at the bottom of the file, after `push_remote`:

```rust
#[tauri::command]
pub fn switch_branch(repo_path: String, branch_name: String, is_remote: bool) -> Result<(), AppError> {
    branch::switch_branch(&repo_path, &branch_name, is_remote)
}
```

- [ ] **Step 2: Register the module and command**

Modify `src-tauri/src/lib.rs` — add `mod branch;` after `mod graph;`:

```rust
mod error;
mod db;
mod repo;
mod graph;
mod branch;
mod search;
mod workdir;
mod diff;
mod remote;
mod commands;
mod test_support;
```

Add `commands::switch_branch,` to the `invoke_handler!` list, after `commands::push_remote,`:

```rust
            commands::fetch_remote,
            commands::pull_remote,
            commands::push_remote,
            commands::switch_branch,
        ])
```

- [ ] **Step 3: Verify the backend still builds and all tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests still pass, plus a successful compile of the updated `commands.rs` and `lib.rs`.

- [ ] **Step 4: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 3: Frontend store wiring

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/store/workspaceStore.ts`

**Interfaces:**
- Consumes: Tauri command `switch_branch` (Task 2).
- Produces: `invokeSwitchBranch(repoPath: string, branchName: string, isRemote: boolean) -> Promise<void>`; `useWorkspaceStore()` gains `switchBranch(repoPath: string, branchName: string, isRemote: boolean) -> Promise<void>`, which throws on failure (the caller — Task 4's `BranchTree` — catches it to show the inline error). Internally extracts a `refreshActiveRepoData(repoPath: string) -> Promise<void>` helper, reused by both `setActiveRepo` and `switchBranch`.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/workspaceStore.test.ts` (extend the existing `vi.mock` factory and add a new test inside the existing `describe` block):

Update the `vi.mock` call at the top of the file to also mock the new function:

```typescript
vi.mock("../lib/tauri", () => ({
  invokeListRepos: vi.fn(),
  invokeAddRepo: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
  invokeSwitchBranch: vi.fn(),
}));
```

Add this test inside the existing `describe("workspaceStore", ...)` block:

```typescript
  it("switchBranch calls invokeSwitchBranch then refreshes branches/tags/commits", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeSwitchBranch as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetBranches as any).mockResolvedValue([
      { name: "feature", isRemote: false, isHead: true, targetOid: "abc" },
    ]);
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().switchBranch("/tmp/a", "feature", false);

    expect(tauriLib.invokeSwitchBranch).toHaveBeenCalledWith("/tmp/a", "feature", false);
    expect(useWorkspaceStore.getState().branches[0].name).toBe("feature");
  });

  it("switchBranch propagates a rejection to the caller", async () => {
    (tauriLib.invokeSwitchBranch as any).mockRejectedValue("cannot switch branches with uncommitted changes");

    await expect(
      useWorkspaceStore.getState().switchBranch("/tmp/a", "feature", false)
    ).rejects.toBe("cannot switch branches with uncommitted changes");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run workspaceStore`
Expected: FAIL — `invokeSwitchBranch` is not exported from `src/lib/tauri.ts` yet, and `switchBranch` doesn't exist on the store.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/tauri.ts` (below the existing `invokePushRemote` export):

```typescript
export const invokeSwitchBranch = (repoPath: string, branchName: string, isRemote: boolean) =>
  invoke<void>("switch_branch", { repoPath, branchName, isRemote });
```

Replace `src/store/workspaceStore.ts` in full:

```typescript
import { create } from "zustand";
import {
  invokeListRepos,
  invokeAddRepo,
  invokeGetBranches,
  invokeGetTags,
  invokeGetCommitGraph,
  invokeEnsureSearchIndex,
  invokeSwitchBranch,
  RepoEntry,
  BranchInfo,
  TagInfo,
  GraphCommit,
} from "../lib/tauri";

interface WorkspaceState {
  repos: RepoEntry[];
  activeRepoId: number | null;
  branches: BranchInfo[];
  tags: TagInfo[];
  commits: GraphCommit[];
  loadRepos: () => Promise<void>;
  addRepo: (path: string) => Promise<void>;
  setActiveRepo: (id: number) => Promise<void>;
  switchBranch: (repoPath: string, branchName: string, isRemote: boolean) => Promise<void>;
  refreshActiveRepoData: (repoPath: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  repos: [],
  activeRepoId: null,
  branches: [],
  tags: [],
  commits: [],

  loadRepos: async () => {
    const repos = await invokeListRepos();
    set({ repos });
  },

  addRepo: async (path: string) => {
    const repo = await invokeAddRepo(path);
    set({ repos: [...get().repos, repo] });
  },

  refreshActiveRepoData: async (repoPath: string) => {
    const [branches, tags, commits] = await Promise.all([
      invokeGetBranches(repoPath),
      invokeGetTags(repoPath),
      invokeGetCommitGraph(repoPath, 200),
    ]);
    set({ branches, tags, commits });
    // Fire-and-forget: index build must not block the UI, and a failed
    // build degrades to the live-walk fallback in search_commits.
    invokeEnsureSearchIndex(repoPath).catch(() => {});
  },

  setActiveRepo: async (id: number) => {
    const repo = get().repos.find((r) => r.id === id);
    if (!repo) return;
    set({ activeRepoId: id });
    await get().refreshActiveRepoData(repo.path);
  },

  switchBranch: async (repoPath: string, branchName: string, isRemote: boolean) => {
    await invokeSwitchBranch(repoPath, branchName, isRemote);
    await get().refreshActiveRepoData(repoPath);
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run workspaceStore`
Expected: all 5 tests pass (3 from earlier plans, 2 new).

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 4: Double-click to switch, with inline error

**Files:**
- Modify: `src/components/BranchTree.tsx`
- Modify: `src/__tests__/BranchTree.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaceStore().switchBranch` (Task 3).
- Produces: nothing further — last task in this plan.

- [ ] **Step 1: Write the failing tests**

First, update the imports at the top of `src/__tests__/BranchTree.test.tsx` — the existing file imports only `describe, it, expect, beforeEach` from `vitest` and `render, screen, act` from `@testing-library/react`, missing `vi`, `fireEvent`, and `waitFor` needed below:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import BranchTree from "../components/BranchTree";
```

Then add to `src/__tests__/BranchTree.test.tsx` (inside the existing `describe("BranchTree", ...)` block, after the existing tests):

```typescript
  it("double-clicking a local branch switches to it", async () => {
    const { useWorkspaceStore } = await import("../store/workspaceStore");
    const switchBranch = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ switchBranch });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("main"));

    await waitFor(() => {
      expect(switchBranch).toHaveBeenCalledWith(undefined, "main", false);
    });
  });

  it("double-clicking a remote branch switches with isRemote true", async () => {
    const { useWorkspaceStore } = await import("../store/workspaceStore");
    const switchBranch = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ switchBranch });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("origin/main"));

    await waitFor(() => {
      expect(switchBranch).toHaveBeenCalledWith(undefined, "origin/main", true);
    });
  });

  it("shows an inline error when switching fails", async () => {
    const { useWorkspaceStore } = await import("../store/workspaceStore");
    const switchBranch = vi.fn().mockRejectedValue("cannot switch branches with uncommitted changes");
    useWorkspaceStore.setState({ switchBranch });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("main"));

    await waitFor(() => {
      expect(screen.getByText("cannot switch branches with uncommitted changes")).toBeInTheDocument();
    });
  });
```

(these tests pass `undefined` as the repo path because the existing `BranchTree` test suite's `beforeEach` never sets `activeRepoId`/`repos` on `useWorkspaceStore` — `BranchTree` doesn't currently read the active repo's path at all, so Task 1's implementation step must have `BranchTree` read it from `useWorkspaceStore` too; see Step 3 below, which sets up `repos`/`activeRepoId` in a new `beforeEach` addition)

Update the existing `beforeEach` in `src/__tests__/BranchTree.test.tsx` to also set an active repo, so the real repo path (not `undefined`) flows through:

```typescript
  beforeEach(() => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "a" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
      ],
      tags: [{ name: "v1.0", targetOid: "a" }],
      // Default no-op so tests that don't care about switchBranch (the
      // three pre-existing tests above) never see a mock left over from a
      // different test — each double-click test below still overrides this
      // with its own vi.fn() right before use.
      switchBranch: vi.fn().mockResolvedValue(undefined),
    });
  });
```

And update the two new tests above to expect `"/tmp/a"` instead of `undefined`:

```typescript
    expect(switchBranch).toHaveBeenCalledWith("/tmp/a", "main", false);
```

```typescript
    expect(switchBranch).toHaveBeenCalledWith("/tmp/a", "origin/main", true);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run BranchTree`
Expected: FAIL — `BranchTree` has no double-click handler and renders no error text yet.

- [ ] **Step 3: Write the implementation**

Replace `src/components/BranchTree.tsx` in full:

```typescript
import { useState } from "react";
import { GitBranch, Tag as TagIcon } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { fuzzyMatch } from "../lib/fuzzyMatch";

export default function BranchTree() {
  const { branches, tags, repos, activeRepoId, switchBranch } = useWorkspaceStore();
  const { query } = useSearchStore();
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const local = branches.filter((b) => !b.isRemote && fuzzyMatch(query, b.name));
  const remote = branches.filter((b) => b.isRemote && fuzzyMatch(query, b.name));
  const filteredTags = tags.filter((t) => fuzzyMatch(query, t.name));

  const handleSwitch = async (branchName: string, isRemote: boolean) => {
    setError(null);
    try {
      await switchBranch(activeRepo?.path as string, branchName, isRemote);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="text-sm p-2">
      <div className="text-xs uppercase text-text-muted mt-2">Branches</div>
      {error && <div className="text-xs text-danger px-2 py-0.5">{error}</div>}
      {local.map((b) => (
        <div
          key={b.name}
          data-head={b.isHead}
          onDoubleClick={() => handleSwitch(b.name, false)}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer ${
            b.isHead ? "bg-accent-soft text-accent font-medium" : "text-text-primary"
          }`}
        >
          <GitBranch size={12} />
          <span>{b.name}</span>
        </div>
      ))}
      <div className="text-xs uppercase text-text-muted mt-2">Remotes</div>
      {remote.map((b) => (
        <div
          key={b.name}
          data-head={b.isHead}
          onDoubleClick={() => handleSwitch(b.name, true)}
          className="flex items-center gap-1.5 px-2 py-0.5 text-text-muted cursor-pointer"
        >
          <GitBranch size={12} />
          <span>{b.name}</span>
        </div>
      ))}
      <div className="text-xs uppercase text-text-muted mt-2">Tags</div>
      {filteredTags.map((t) => (
        <div key={t.name} className="flex items-center gap-1.5 px-2 py-0.5 text-text-primary">
          <TagIcon size={12} />
          <span>{t.name}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run BranchTree`
Expected: all tests pass (3 existing + 3 new = 6).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all Vitest suites pass, including this plan's new tests.

Run: `npm run e2e`
Expected: all 3 existing Playwright specs still pass — none of them double-click a branch, so this change doesn't affect them.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all Rust tests pass, including this plan's 4 new ones — no regressions.

- [ ] **Step 6: Mark task complete**

No commit (see Global Constraints). Update the progress ledger — branch switching is now complete.

---

## Definition of Done

- Double-clicking a local branch checks it out; double-clicking a remote branch creates-and-tracks (or reuses) a local branch and checks that out — verified by Rust unit tests (Task 1) and frontend tests (Task 4).
- Switching is blocked with a clear inline error when the working tree is dirty — verified in both layers.
- `cargo test`, `npm test`, and `npm run e2e` all pass with no regressions from any prior plan.
