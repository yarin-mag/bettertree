# PR Filter Bar: Add/Remove Filters

## Problem

The PR filter bar always shows all 12 fields (Author, Label, Assignee, Reviewer, Project, Milestone, Created, Updated, Base branch, Head branch, State, Sort) whether or not someone uses them, and there's no way to hide the ones that don't matter to a given workflow or bring back a hidden one.

## Scope

Make every one of the 12 fields individually show/hide-able, persisted across restarts, with a default visible set of Created, Updated, Base branch, Head branch, State, Sort. Author, Label, Assignee, Reviewer, Project, Milestone start hidden.

Out of scope: reordering fields (fixed canonical order is preserved, just filtered by visibility), any change to the qualifier semantics of individual fields themselves.

## Design

### 1. `src/lib/visibleFilters.ts` (new)

Same shape as the existing `recentBranches.ts` localStorage helper:
- `DEFAULT_VISIBLE_FILTERS = ["created", "updated", "base", "head", "state", "sort"]`
- `getVisibleFilters(): string[]` — reads `localStorage["bettertree.visibleFilters"]`, returns the default array on any missing/corrupt data.
- `setVisibleFilters(keys: string[]): void` — writes the given key list back.

### 2. `PullRequestsScreen.tsx` — data-driven fields

A `FILTER_DEFS` array (outside the component, pure data) lists all 12 fields in their current bar order: `{ key: "author", label: "Author" }`, ... `{ key: "state", label: "State" }`, `{ key: "sort", label: "Sort" }`. The component keeps `visibleFilterKeys` in state (lazy-initialized from `getVisibleFilters()`), and renders `FILTER_DEFS.filter(f => visibleFilterKeys.includes(f.key))` — so visible fields always appear in the same fixed relative order regardless of when they were added.

Each rendered field is wrapped exactly as today (`<label>{label}<Control /></label>`) plus a small **×** button (`X` icon, `aria-label="Remove {label} filter"`) that calls `removeFilter(key)`:
- For every key except `state`: `setQualifier(key, null)` (clears its qualifier) then drops it from `visibleFilterKeys` and persists.
- For `state`: reuses the existing `handleStateChange("")` (already clears both `is:`/`state:` tokens back to "Open") before dropping it from `visibleFilterKeys`.

A `renderFilterControl(key)` function replaces the current one-block-per-field JSX with a switch over `key`, producing the exact same control markup that exists today for each field (text input, the two `<select>`s, the two `DateRangeFilter`s, the two `BranchCombobox`es) — purely a refactor of existing JSX into a lookup, no behavior change per field.

### 3. `FilterVisibilityMenu.tsx` (new)

Structured like `BranchCombobox`/`DateRangeFilter`: a trigger button (`SlidersHorizontal` icon, text "Filters") + `relative`/`absolute z-20` popover with the same outside-click-closes pattern. Placed in the bar right before the Search button.

Props: `{ filters: { key: string; label: string }[]; visible: string[]; onToggle: (key: string) => void }`. The popover lists all 12 filters as checkboxes (checked = currently visible); toggling one calls `onToggle(key)`, which the parent routes to the same `addFilter`/`removeFilter` logic as the ×.

## Testing

- `visibleFilters.test.ts` (new): defaults returned when nothing stored; round-trips a custom set; corrupt/missing localStorage falls back to defaults.
- `FilterVisibilityMenu.test.tsx` (new): renders all 12 as checkboxes with correct checked state; clicking one calls `onToggle` with its key; closes on outside click.
- `PullRequestsScreen.test.tsx`: default render shows only the 6 default fields (Author etc. absent); clicking Author's × hides it and clears `author:` from the query; checking Author in the Filters menu shows it again. The existing "typing in the author filter" test needs updating — Author now starts hidden, so it must open the Filters menu and check "Author" before it can find the input. The six default-visible fields (Base branch, Head branch, Created, Updated, State, Sort) are otherwise unaffected — their existing tests keep working unchanged since those fields are visible from the start.

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — this spec is saved to disk only, no commit step.
