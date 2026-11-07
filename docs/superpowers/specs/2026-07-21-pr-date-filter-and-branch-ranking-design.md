# PR Date Filters + Substring-First Branch Ranking

## Problem

1. The PR filter bar has no way to filter by date (created/updated), even though GitHub's PR search supports it.
2. Branch search (both the Base/Head picker in the PR panel and the sidebar's branch search) ranks purely by fuzzy subsequence match, so typing "mobile" can surface a branch that merely contains those letters in order before a branch whose name literally contains "mobile" as a substring.

## Scope

Two independent additions:
1. A `DateRangeFilter` popover component, used twice in the PR filter bar (Created, Updated).
2. A `rankMatches` ranking helper, used by both `BranchCombobox` and `BranchTree`'s branch lists (not tags — only branch names were called out).

Out of scope: changing how tags are searched/ranked; any backend change (GitHub's PR search API already supports `created:`/`updated:` range qualifiers, and the existing `qualifierQuery.ts` tokenizer already handles arbitrary `key:value` tokens with no spaces, so ranges like `2026-01-01..2026-02-01` need no tokenizer changes).

## Design

### 1. `rankMatches` (substring-first ranking)

New export in `src/lib/fuzzyMatch.ts`:

```ts
export function rankMatches<T>(query: string, items: T[], getText: (item: T) => string): T[] {
  if (!query) return items;
  const q = query.toLowerCase();
  const substringMatches: T[] = [];
  const fuzzyOnlyMatches: T[] = [];
  for (const item of items) {
    const text = getText(item);
    if (text.toLowerCase().includes(q)) {
      substringMatches.push(item);
    } else if (fuzzyMatch(query, text)) {
      fuzzyOnlyMatches.push(item);
    }
  }
  return [...substringMatches, ...fuzzyOnlyMatches];
}
```

It partitions (not unions two filters), so an item lands in exactly one bucket — no duplicates possible. Non-matching items are dropped, same as the current `filter(fuzzyMatch(...))` behavior. Empty query returns the input unchanged (matches `fuzzyMatch`'s existing "empty query matches everything" behavior, and preserves original order rather than reordering when there's nothing to rank against).

**`BranchCombobox.tsx`**: `const filtered = branches.filter((b) => fuzzyMatch(filterText, b));` becomes `const filtered = rankMatches(filterText, branches, (b) => b);`.

**`BranchTree.tsx`**: `local`/`remote` currently combine the `isRemote` split and the fuzzy filter in one `.filter()` call. That becomes two steps — filter by `isRemote` first (unrelated to the query), then rank the result by name:
```ts
const local = rankMatches(query, branches.filter((b) => !b.isRemote), (b) => b.name);
const remote = rankMatches(query, branches.filter((b) => b.isRemote), (b) => b.name);
```
Tags (`filteredTags`) are untouched — still plain `fuzzyMatch` filtering.

### 2. `DateRangeFilter` component

New `src/components/DateRangeFilter.tsx`, styled and structured like `BranchCombobox` (trigger button + popover, `relative`/`absolute z-20` positioning, same outside-click-closes pattern) but with date inputs instead of a branch list.

**Value encoding** (stored as the qualifier's raw string, e.g. `created:2026-01-01..2026-02-01`):
- Both From and To set → `${from}..${to}` (GitHub's inclusive range syntax).
- Only From set → `>=${from}`.
- Only To set → `<=${to}`.
- Neither set → qualifier removed (`onChange(null)`).

The component is fully controlled and derives its displayed From/To directly from the `value` prop (no internal from/to state to keep in sync) via a small `parseRange(value)` helper that reverses the encoding above.

**Props**: `{ value: string | undefined; onChange: (value: string | null) => void }` — no `label` prop, same as `BranchCombobox`; the parent wraps it in a `<label>Created ...</label>` for the field name, relying on `<label>` wrapping a `<button>` (a labelable element) for accessible-name association.

**Trigger summary**: "Any" when unset; `${from} → ${to}` when both set; `From ${from}` / `Until ${to}` when only one side is set.

**Popover contents**:
- A row of four preset buttons: Today, Last 7 days, Last 30 days, This month. Each computes a `{from, to}` pair from the current date and calls `onChange(buildValue(from, to))` immediately (no separate "Apply" step, consistent with every other filter in the bar being live-on-change).
- Two `<input type="date">` rows (From, To), each calling `onChange` immediately on change with the recomputed value.
- A "Clear" button (shown only when a value is set) that calls `onChange(null)`.

**Placement in `PullRequestsScreen.tsx`**: two instances — "Created" (qualifier key `created`) and "Updated" (qualifier key `updated`) — inserted right after the Milestone field and before Base branch.

## Testing

- `fuzzyMatch.test.ts`: new tests for `rankMatches` — substring matches ranked before fuzzy-only matches, non-matches excluded, no duplicates, empty query returns input unchanged/unreordered.
- `BranchCombobox.test.tsx`: a test asserting row order when the branch list contains both a substring match and a fuzzy-only match for the same query.
- `BranchTree.test.tsx`: equivalent ordering test for the local-branches list.
- `DateRangeFilter.test.tsx` (new): trigger shows "Any" by default and the correct summary once a value is set; clicking a preset calls `onChange` with the expected computed range (tests fix "today" via `vi.setSystemTime` for determinism); editing From/To calls `onChange` with the correctly built value; Clear calls `onChange(null)`; popover closes on outside click.
- `PullRequestsScreen.test.tsx`: two new tests — selecting the "Today" preset under Created/Updated sets the corresponding qualifier in the query.

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — this spec is saved to disk only, no commit step.
