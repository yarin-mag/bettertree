# Branch UX Round 2: Loading Indicator, Combobox Redesign, Tag Checkout, Detached HEAD, Collapsible Remotes

## Problem

Follow-up feedback on the branch-filter work ([[2026-07-21-pr-branch-search-ux-design]]):

1. The Base/Head branch combobox shows an empty list for a few seconds on open (branches load async) with no loading feedback, and the plain-list style should be "fancier."
2. Tags in the sidebar branch tree have no click handler at all — there's no way to check one out.
3. The sidebar's "Remotes" section is always fully expanded, even though it's rarely the first thing someone needs.

## Scope

Four workstreams, some touching the Rust backend:

1. **Loading indicator + combobox redesign** — frontend only.
2. **Tag checkout (detached HEAD)** — new Rust command (none exists today for tag/ref checkout), new invoke wrapper, new store action, new UI wiring.
3. **Detached-HEAD indicator** — changes the shape of an existing Rust command's return value, new store state, new sidebar UI.
4. **Collapsible Remotes section** — frontend only, local component state.

Out of scope: any change to `switch_branch`'s existing branch-checkout behavior; a full "recent items" system beyond the branch picker; any commit-graph or working-copy changes.

## Design

### 1. Loading indicator + `BranchCombobox` redesign

**Loading state** (`src/store/githubStore.ts`): add `isLoadingBranches: boolean`, set `true` before `invokeListGithubBranches(repoPath)` and `false` after, mirroring the existing `isLoadingPrs` pattern around `searchPullRequests`.

**`BranchCombobox` props**: add `isLoading?: boolean`. While true, the trigger renders a small spinner in place of the chevron and the button is disabled (can't open a popover with nothing in it yet).

**Visual redesign** (style "command palette," chosen from a mockup comparing three directions):
- Popover widens to 260px (from 192px).
- Filter input gets a leading search icon in the accent color, placeholder changes to "Jump to branch...".
- Rows highlight with `bg-accent-soft` (not `bg-hover`) on hover/keyboard-highlight.
- The row matching the current `value` shows a small "current" tag (reusing the existing `kbd`-style tag look: `bg-elevated`/`border-border-subtle`, tiny uppercase-ish label) to its right.
- A footer bar shows keyboard hints: `↑ ↓ navigate · ↵ select · esc close`.

**Recent branches** (persisted, shared across both Base and Head pickers):
- New helper `src/lib/recentBranches.ts`: `getRecentBranches(): string[]` (reads `localStorage["bettertree.recentBranches"]`, parses JSON, returns `[]` on any error/absence) and `recordRecentBranch(name: string): void` (moves `name` to the front, dedupes, caps at 5, writes back to the same key).
- `BranchCombobox` calls `recordRecentBranch(value)` inside `selectRow` whenever a non-null row is picked, and reads `getRecentBranches()` when the popover opens.
- Whenever the popover is open, a "Recent" section (only entries that are both in the recent list and in the current `branches` prop, in recency order) renders above the full list — regardless of whether the filter text is empty. The full list always remains visible below it; recents are a shortcut, not a replacement for the full list. (This intentionally differs from the mockup, which hid the full list until the user typed — always-visible reads as more usable and avoids a picker that looks empty until you start typing.)
- If there are no recents yet (fresh install, or none of the recorded names are in the current `branches` prop), the Recent section is omitted entirely — no empty-state placeholder.

### 2. Tag checkout → detached HEAD

Today, `switch_branch` (`src-tauri/src/branch.rs`) always resolves/creates a local branch ref and calls `repo.set_head(&local_ref_name)` — it can never produce a detached HEAD, and no generic ref/tag checkout command exists anywhere in `src-tauri/src`.

**New Rust command** `checkout_tag(repo_path: String, tag_name: String) -> Result<(), AppError>`:
- Resolve the tag to a commit: `repo.revparse_single(&format!("refs/tags/{tag_name}"))?.peel_to_commit()?` (handles both lightweight and annotated tags via `peel_to_commit`).
- `repo.checkout_tree(commit.as_object(), None)` (matching the existing `CheckoutBuilder` usage style in `switch_branch`).
- `repo.set_head_detached(commit.id())?`.
- Registered as a Tauri command alongside `switch_branch` in `commands.rs` and `lib.rs`'s invoke handler list.

**Frontend wiring**:
- `src/lib/tauri.ts`: `invokeCheckoutTag(repoPath: string, tagName: string): Promise<void>` → `invoke("checkout_tag", { repoPath, tagName })`.
- `src/store/workspaceStore.ts`: new `checkoutTag: (repoPath: string, tagName: string) => Promise<void>`, same shape as `switchBranch` — call the invoke, then `refreshActiveRepoData(repoPath)`.
- `src/components/BranchTree.tsx`: tag rows get `onDoubleClick={() => handleCheckoutTag(t.name)}`, reusing the same inline-error `useState` and try/catch pattern already used for branch-switch failures (so a failed tag checkout surfaces the same way a failed branch switch does today).

### 3. Detached-HEAD indicator

Traced today's behavior: `list_branches` (`src-tauri/src/repo.rs`) computes `is_head` per branch by string-comparing each branch's shorthand name against `repo.head()?.shorthand()`. When HEAD is detached, `shorthand()` returns the abbreviated OID (e.g. `"a1b2c3d"`), which never equals a branch name — so the command doesn't error, it just silently returns a branch list where no branch has `isHead: true`. There's no existing signal anywhere (backend or frontend) that HEAD is specifically detached, and no "on branch X" status text exists in the UI to have gone stale.

**Backend change**: `list_branches`'s return type changes from a bare `Vec<BranchInfo>` to:
```rust
struct BranchListResult {
    branches: Vec<BranchInfo>,
    head_detached: bool,
    head_oid: Option<String>,
}
```
`head_detached` and `head_oid` are derived from the same `repo.head()` call already being made — no extra git operations.

**Frontend**:
- `src/lib/tauri.ts`: `invokeGetBranches`'s return type updates to match (`{ branches: BranchInfo[], headDetached: boolean, headOid: string | null }`).
- `src/store/workspaceStore.ts`: new `headDetached: boolean`, `headOid: string | null` state, set in `refreshActiveRepoData` alongside `branches`.
- `src/components/BranchTree.tsx`: when `headDetached` is true, render a small badge above the Branches list: `Detached @ <name>`, where `<name>` is the name of the tag in the already-loaded `tags` list whose `targetOid === headOid` (if any), else `headOid` sliced to 7 characters.

### 4. Collapsible Remotes section

`BranchTree.tsx` gets local `const [remotesCollapsed, setRemotesCollapsed] = useState(true)` (collapsed by default). The "Remotes" header becomes a clickable row (button, not a plain div) showing a chevron that flips direction based on `remotesCollapsed`, plus a count — `Remotes (12)` — so the section reads as non-empty even while collapsed. Clicking toggles `remotesCollapsed`; the remote branch rows only render when it's false.

## Testing

- `BranchCombobox`: new tests for the loading state (spinner shown, trigger disabled when `isLoading`), recent-section rendering (shows only entries present in both localStorage and `branches`, ordered by recency, capped at 5), and that selecting a branch calls `recordRecentBranch`.
- `recentBranches.ts`: unit tests for cap-at-5, dedup-and-move-to-front, and graceful handling of corrupt/missing localStorage data.
- Rust: unit test for `checkout_tag` (both a lightweight and an annotated tag fixture, asserting `repo.head()` is detached afterward and points at the right commit) alongside the existing `switch_branch` tests in `branch.rs`/`repo.rs`.
- `BranchTree.tsx`: tests for tag double-click calling `checkoutTag`, the detached-HEAD badge rendering when `headDetached` is true and being absent otherwise, and the Remotes section defaulting to collapsed and toggling on click.

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — this spec is saved to disk only, no commit step.
