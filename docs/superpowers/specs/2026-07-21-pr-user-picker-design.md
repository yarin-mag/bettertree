# PR Author/Assignee/Reviewer: Real User Dropdown

## Problem

Author, Assignee, and Reviewer are plain text inputs — you have to already know the exact GitHub username. Base/Head branch already show a real searchable list; these three should work the same way.

## Scope

New backend endpoint + store field for the repo's assignable-users list, and a new `UserCombobox` component (Base/Head branch's `BranchCombobox`, minus the branch-specific "Recent" section) wired to Author/Assignee/Reviewer.

Out of scope: Label, Project, Milestone (not requested); any change to how PR search interprets these qualifiers (`author:`/`assignee:`/`review-requested:` already take a plain username — nothing changes there, only how the value gets picked).

## Design

### 1. Backend — `list_assignable_users`

Mirrors `list_branches`/`list_github_branches` exactly (same `gh api ... --paginate --jq` pattern), against GitHub's own "who can be assigned in this repo" endpoint:

```rust
pub fn list_assignable_users(runner: &dyn GhRunner, owner: &str, repo: &str) -> Result<Vec<String>, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/assignees");
    let output = runner.run(&["api", &endpoint, "--paginate", "--jq", ".[].login"])?;
    Ok(output.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
}
```

New Tauri command `list_assignable_users` (same shape as `list_github_branches`'s wrapper — `resolve_owner_repo` inside `run_blocking`), registered in `lib.rs`. This one list is reused for Author, Assignee, and Reviewer — in practice PR authors/reviewers are essentially always repo collaborators, so it's a reasonable single source for all three rather than three separate endpoints.

### 2. Frontend plumbing

- `src/lib/tauri.ts`: `invokeListAssignableUsers(repoPath: string): Promise<string[]>`.
- `githubStore.ts`: `assignableUsers: string[]`, `isLoadingAssignableUsers: boolean`, `loadAssignableUsers(repoPath): Promise<void>` — identical shape to `branches`/`isLoadingBranches`/`loadBranches`.
- `PullRequestsScreen.tsx`: calls `loadAssignableUsers(activeRepo.path)` in the same mount `useEffect` that already calls `loadBranches`.

### 3. `UserCombobox` component (new)

Same interaction/visuals as `BranchCombobox` (popover, `rankMatches` substring-first search, keyboard nav, loading spinner, "current" tag, kbd-hint footer) but **without** the Recent section — that's backed by `recentBranches.ts`'s branch-specific localStorage list, and mixing usernames into it would be wrong (and recent-assignees wasn't asked for). Props: `{ value: string | undefined; onChange: (value: string | null) => void; options: string[]; isLoading?: boolean }` (named `options` rather than `branches` since it's now domain-generic).

### 4. Wiring

In `PullRequestsScreen.tsx`'s `renderFilterControl`, the `"author"`, `"assignee"` (qualifier key stays `assignee`), and `"review-requested"` cases switch from a plain `<input>` to:
```tsx
<UserCombobox
  value={getQualifier(query, key)}
  onChange={(v) => setQualifier(key, v)}
  options={assignableUsers}
  isLoading={isLoadingAssignableUsers}
/>
```

## Testing

- `github.rs`: three new tests for `list_assignable_users`, mirroring `list_branches`'s three tests exactly (parses newline output, ignores blank lines, calls `gh api` with `--paginate` against `repos/{owner}/{repo}/assignees`).
- `githubStore.test.ts`: `loadAssignableUsers` populates `assignableUsers` and toggles `isLoadingAssignableUsers`.
- `UserCombobox.test.tsx` (new): same coverage as `BranchCombobox.test.tsx` minus the Recent-section tests (no Recent section exists here).
- `PullRequestsScreen.test.tsx`: Author/Assignee/Reviewer now open a searchable dropdown instead of accepting free text — update/replace their existing "typing in the X filter" tests accordingly, plus a test confirming `loadAssignableUsers` fires on mount alongside `loadBranches`.

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — this spec is saved to disk only, no commit step.
