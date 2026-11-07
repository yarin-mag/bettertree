# Local/Remote Branch Scope Toggle + Sidebar Section Separators — Design

## Goal

A single global toggle — "Show remote branches" — that controls whether remote-tracking branches are considered anywhere the app deals in *real local git branches* (the sidebar's branch tree, and the Compare screen's ref pickers). Alongside it, visually separate the sidebar's Branches / Remotes / Tags sections with a divider so each reads as a clearly bounded block.

## Scope decisions (from brainstorming)

- **Affects**: sidebar `BranchTree`, Compare screen's `RefCombobox`. Both consume `workspaceStore.branches`, which carries a real `isRemote` flag from git2.
- **Does not affect**: the PR screen's branch filter dropdowns (`BranchCombobox`, fed by `githubStore.branches`). That list comes entirely from `gh api` — every entry in it is inherently "a branch on the remote," there's no local subset to filter to, so the concept doesn't map there. Left untouched.
- **Persistence**: global, localStorage-backed, not per-repo — same pattern as `themeStore`.
- **Default**: `true` (remotes shown) — preserves current behavior for existing users; this is an opt-out, not an opt-in.

## Architecture

New `src/store/branchScopeStore.ts`, mirroring `themeStore.ts`'s exact shape:

```ts
interface BranchScopeState {
  showRemoteBranches: boolean;
  toggleShowRemoteBranches: () => void;
}
```

Reads/writes `localStorage.getItem/setItem("branchScope.showRemoteBranches")` (stringified boolean), same persistence convention as `theme`.

## Components

- **`BranchTree.tsx`**: a small checkbox + label ("Show remotes") rendered inline with the existing "Branches" section header. When `showRemoteBranches` is `false`, the entire "Remotes (N)" collapsible block (header button + list) is not rendered at all — not just collapsed. Local branches and Tags sections are unaffected. A thin divider is added between Branches→Remotes and Remotes→Tags (rendered only where the section it's introducing actually exists — no divider before a hidden Remotes section).
- **`CompareScreen.tsx`**: currently does `branches.map((b) => b.name)`, discarding `isRemote` before handing the list to `RefCombobox`. This changes to filter on `showRemoteBranches` first: `branches.filter((b) => showRemoteBranches || !b.isRemote).map((b) => b.name)`. `RefCombobox` itself doesn't change — it already just renders whatever branch list it's given.
- **`RefCombobox.tsx`**: no changes. It has no concept of remote/local; it only ever sees names. Correct behavior falls entirely out of what `CompareScreen` passes in.

## Divider styling

A thin horizontal rule with a subtle gradient fade at both ends (fully transparent at the edges, `border-subtle`-toned in the middle) rather than a flat full-width line — reads as a soft section break instead of a hard rule, fitting the sidebar's minimal dark theme. Implemented as a `<div>` with a CSS `background: linear-gradient(...)` rather than a `border`, since a plain `border-t` would look identical to the existing header/footer borders already used elsewhere in the sidebar and wouldn't read as a distinct "section boundary" indicator.

## Data flow

1. App loads → `branchScopeStore`'s `showRemoteBranches` initializes from localStorage (defaulting to `true` if unset).
2. User unchecks "Show remotes" in the sidebar → `toggleShowRemoteBranches()` flips state + persists.
3. `BranchTree` re-renders, dropping the Remotes section.
4. `CompareScreen` re-renders (subscribed to `branchScopeStore`), recomputing the filtered branch list it passes to both `RefCombobox` instances (base + compare pickers).
5. No backend call involved — this is a pure client-side filter over already-fetched `workspaceStore.branches`.

## Testing

- `branchScopeStore.test.ts`: defaults to `true`; `toggleShowRemoteBranches` flips and persists to localStorage; a fresh store instance reads the persisted value back.
- `BranchTree.test.tsx`: Remotes section renders when `showRemoteBranches` is `true`; disappears entirely when `false`; checkbox reflects current state and calls `toggleShowRemoteBranches` on click; local branches/Tags unaffected either way; dividers appear between the sections that are actually rendered.
- `CompareScreen.test.tsx`: with a mix of local + remote branches in `workspaceStore`, the branch list handed to `RefCombobox` excludes remote entries when `showRemoteBranches` is `false`, includes them when `true`.
