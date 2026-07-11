# Bettertree Branch Switching

Date: 2026-07-06

## Purpose

`BranchTree` currently renders branches as read-only rows — no way to actually check one out. This adds double-click-to-switch for both local and remote branches, the single most obviously-missing interaction from the v1 git client.

## Scope

- Double-click a **local** branch row → checkout that branch.
- Double-click a **remote** branch row (e.g. `origin/main`) → if a local branch of the same short name exists, switch to it; otherwise create a new local branch tracking that remote commit, then switch to it.
- Blocked with a clear inline error if the working tree has uncommitted changes (modified, staged, or untracked) — no forced/destructive checkout in v1.
- **Out of scope**: checking out a tag (detached HEAD is a different, unaddressed concept), any merge/rebase-based branch creation flow, force-checkout / discard-changes-and-switch.

## Backend

New `src-tauri/src/branch.rs`:

```
pub fn switch_branch(repo_path: &str, branch_name: &str, is_remote: bool) -> Result<(), AppError>
```

- Calls `workdir::get_status(repo_path)` first; if the result is non-empty, returns `AppError::Operation("cannot switch branches with uncommitted changes".into())` without touching the repo.
- For a local branch (`is_remote: false`): resolves `refs/heads/<branch_name>`, does a `git2` `checkout_tree` (default **Safe** strategy — no `.force()`, so it also refuses to overwrite anything our own status pre-check missed) followed by `set_head`.
- For a remote branch (`is_remote: true`, `branch_name` like `"origin/main"`): splits off the short name (`"main"`). If `refs/heads/main` already exists, switches to it directly (no tracking changes). Otherwise creates a new local branch at the remote branch's commit, sets its upstream to the remote branch, then switches to it.

New Tauri command `switch_branch(repo_path: String, branch_name: String, is_remote: bool) -> Result<(), AppError>` wired into `commands.rs`/`lib.rs` following the existing pattern.

## Frontend

- `src/lib/tauri.ts`: `invokeSwitchBranch(repoPath, branchName, isRemote)`.
- `workspaceStore.ts`: extract the branches/tags/commits refresh block currently duplicated inline in `setActiveRepo` into a private `refreshActiveRepoData(repoPath)` helper; add `switchBranch(repoPath, branchName, isRemote)` that calls `invokeSwitchBranch` then reuses that helper to refresh.
- `BranchTree.tsx`: each local/remote branch row gets `onDoubleClick` calling `switchBranch`. Local `useState<string | null>` holds an error message; on rejection, show it as inline red text directly under the "Branches" section label. Clears on the next successful switch attempt.

## Testing

- Rust (`branch.rs`, using existing `test_support` fixtures): clean switch to an existing local branch; switch blocked when a tracked file is modified; remote branch with no local counterpart creates-and-tracks a new local branch; remote branch whose local counterpart already exists just switches to it, unchanged.
- Frontend: `BranchTree` test — double-click calls `switchBranch` with the right args; a rejected promise renders the inline error text.
- Full regression (`cargo test`, `npm test`, `npm run e2e`) at the end, per the project's established cross-phase testing policy — no existing test asserts on branch-row click behavior today, so no existing test should need to change.

## Out of Scope (restated)

- Tag checkout / detached HEAD.
- Force-checkout discarding local changes.
- Any stash-like "save my changes and switch anyway" flow.
