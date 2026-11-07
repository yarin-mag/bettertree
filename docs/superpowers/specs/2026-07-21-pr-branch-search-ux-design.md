# PR Branch Filters + Search Entry-Point Clarity

## Problem

1. `PullRequestsScreen`'s "Base branch" filter is a plain `<input>` with an HTML `<datalist>` — not a real dropdown, and there's no "head branch" (source) filter at all, even though `qualifierQuery.ts` already supports arbitrary `key:value` qualifiers and GitHub's PR search supports both `base:` and `head:` natively.
2. The app has three unrelated search UIs with no visual connection: the top `SearchBar` (live client-side fuzzy filter over loaded branches/tags/commits), the `Sidebar` bottom button (opens `AdvancedSearch`, a server-side commit-history search), and the PR filter bar's own free-text box. The sidebar button in particular is buried under the Tags list with a generic "Search" label, giving no hint it's a different feature from the top bar.

## Scope

Both fixed in this pass:
- Add a real branch combobox for `base:`/`head:` PR filters.
- Relabel/reposition the commit-history search trigger so it reads as a distinct feature from the top bar's live filter, without merging the two.

Out of scope: merging the three search UIs into one (rejected — keeping them separate but clarified was the chosen direction), any change to `AdvancedSearch.tsx` internals, any new UI library dependency (none exists in `package.json`; building a small custom component matches the app's existing plain-input style).

## Design

### 1. `BranchCombobox` component (new: `src/components/BranchCombobox.tsx`)

Shared by both the Base and Head branch filters.

- **Trigger**: button styled like the existing filter inputs (`w-32 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary`), displaying the selected branch name or "Any".
- **Popover**: opens on click, positioned below the trigger. Contains:
  - An autofocused text input for filtering.
  - A scrollable list of branch names, fuzzy-matched against the typed text using the existing `fuzzyMatch` util already used by `BranchTree.tsx` (no new matching logic).
  - An "Any" row pinned at the top of the list, which clears the qualifier (`onChange(null)`).
- **Keyboard**: ↑/↓ moves the highlighted row, Enter selects it, Esc closes the popover without changing the value.
- **Dismissal**: clicking outside the popover closes it (reuse an existing outside-click hook if one exists in the codebase; otherwise add a minimal one scoped to this component).
- **Props**: `value: string | undefined`, `onChange: (value: string | null) => void`, `branches: string[]`, `label: string` (used for the trigger's `aria-label`).

### 2. `PullRequestsScreen.tsx` wiring

- Replace the current Base branch `<input>` + `<datalist>` (lines 109–123) with:
  `<BranchCombobox value={getQualifier(query, "base")} onChange={(v) => setQualifier("base", v)} branches={branches} label="Base branch" />`
- Add a new **Head branch** field immediately after it, same component, wired to the `head` qualifier: `setQualifier("head", v)`. This requires no backend/query-building change — `setQualifier`/`getQualifier` already handle arbitrary keys, and GitHub's PR search API accepts `head:` the same way it accepts `base:`.
- Filter bar order becomes: free-text search → Author → Label → Assignee → Reviewer → Project → Milestone → **Base branch** → **Head branch** → Sort → Search button.

### 3. Search entry-point clarification

- `Sidebar.tsx`: remove the bottom "Search" button (current lines 24–29) entirely.
- `SearchBar.tsx`: add a small icon-only button to the right of the search input, using a `History` icon (lucide-react) and `title="Search commit history"`, wired to the existing `useSearchStore().activateSearch`. This sits next to the existing `Search` icon already shown on the left of the input, so both affordances are visually adjacent with visually distinct icons and a tooltip distinguishing them.
- No changes to `AdvancedSearch.tsx` or `SearchResultsPane.tsx` — only the trigger's location and label change.

## Testing

- New unit test for `BranchCombobox`: opens on click, filters the list as text is typed, selects a branch on click and on Enter, clears back to "Any", closes on outside click and on Esc.
- Update `PullRequestsScreen.test.tsx` (existing base-branch assertions at lines 60, 103, 106) to drive the new combobox instead of firing a `change` event on a plain input; add equivalent coverage for the new head-branch field.
- Move the "activates search" assertion currently on `Sidebar`'s button to `SearchBar`'s new icon button; update/remove the corresponding `Sidebar` test.

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — this spec is saved to disk only, no commit step.
