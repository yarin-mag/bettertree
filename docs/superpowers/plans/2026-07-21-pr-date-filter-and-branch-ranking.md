# PR Date Filters + Substring-First Branch Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Created/Updated date-range filters (with quick presets) to the PR filter bar, and make branch search in both the Base/Head picker and the sidebar rank substring matches before fuzzy-only matches.

**Architecture:** A single new `rankMatches` helper in the existing `fuzzyMatch.ts` replaces the plain `filter(fuzzyMatch(...))` call sites in `BranchCombobox` and `BranchTree`. Separately, a new `DateRangeFilter` component — structurally identical to `BranchCombobox` (trigger button + `absolute`/`relative` popover, same outside-click-close pattern) — is added twice to `PullRequestsScreen`'s filter bar, writing GitHub-search-compatible range strings (`YYYY-MM-DD..YYYY-MM-DD`, or `>=`/`<=` for open-ended) through the existing `setQualifier`. No backend or `qualifierQuery.ts` changes are needed — GitHub's PR search already accepts `created:`/`updated:` ranges, and the tokenizer already treats any space-free string as one token.

**Tech Stack:** React 18 + TypeScript, Zustand, Tailwind CSS, Vitest + @testing-library/react. No new dependencies.

## Global Constraints

- This project is intentionally not tracked in git (explicit prior decision — no `git init`/`git add`/`git commit`; each task ends by running tests, not committing).
- Tests live under `src/__tests__/`, matching every existing test file in this codebase.
- Date formatting must use `Date`'s local getters (`getFullYear`/`getMonth`/`getDate`), never `toISOString()` — `toISOString()` converts to UTC first, which silently shifts a local midnight-based date (e.g. "1st of this month") to the previous day in any positive-UTC-offset timezone. All date-preset tests fix the system clock via `vi.setSystemTime` to a fixed **noon UTC** instant specifically so the local calendar date is stable across realistic timezones.
- `rankMatches` partitions its input (each item lands in exactly one of two buckets or is dropped) — never unions two separate `.filter()` passes, which would risk duplicates.

---

### Task 1: `rankMatches` helper

**Files:**
- Modify: `src/lib/fuzzyMatch.ts`
- Modify: `src/__tests__/fuzzyMatch.test.ts`

**Interfaces:**
- Consumes: the existing `fuzzyMatch(query, target): boolean` in the same file.
- Produces: `export function rankMatches<T>(query: string, items: T[], getText: (item: T) => string): T[]`, consumed by Task 2 (`BranchCombobox`) and Task 3 (`BranchTree`).

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/fuzzyMatch.test.ts`:

```ts
import { fuzzyMatch, rankMatches } from "../lib/fuzzyMatch";
```
(replace the existing `import { fuzzyMatch } from "../lib/fuzzyMatch";` line with the one above)

```ts
describe("rankMatches", () => {
  it("ranks substring matches before fuzzy-only matches", () => {
    const items = ["moxbxilxe", "mobile", "release/mobile-v2"];
    expect(rankMatches("mobile", items, (s) => s)).toEqual(["mobile", "release/mobile-v2", "moxbxilxe"]);
  });

  it("excludes items that match neither as a substring nor fuzzily", () => {
    const items = ["mobile", "completely-unrelated"];
    expect(rankMatches("mobile", items, (s) => s)).toEqual(["mobile"]);
  });

  it("never duplicates an item across the two buckets", () => {
    const items = ["mobile"];
    const result = rankMatches("mobile", items, (s) => s);
    expect(result).toEqual(["mobile"]);
    expect(result.length).toBe(1);
  });

  it("returns the input unchanged and unreordered when the query is empty", () => {
    const items = ["zebra", "apple", "mango"];
    expect(rankMatches("", items, (s) => s)).toEqual(["zebra", "apple", "mango"]);
  });

  it("works with a getText accessor over non-string items", () => {
    const items = [{ name: "moxbxilxe" }, { name: "mobile" }];
    expect(rankMatches("mobile", items, (i) => i.name)).toEqual([{ name: "mobile" }, { name: "moxbxilxe" }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- fuzzyMatch`
Expected: FAIL — `rankMatches` is not exported from `../lib/fuzzyMatch`.

- [ ] **Step 3: Implement `rankMatches`**

Append to `src/lib/fuzzyMatch.ts`:

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- fuzzyMatch`
Expected: PASS — all tests green, including the 4 pre-existing `fuzzyMatch` tests and the 5 new `rankMatches` tests.

---

### Task 2: Rank branches in `BranchCombobox`

**Files:**
- Modify: `src/components/BranchCombobox.tsx`
- Modify: `src/__tests__/BranchCombobox.test.tsx`

**Interfaces:**
- Consumes: `rankMatches` from Task 1.
- Produces: no new exports — same `{ value, onChange, branches, isLoading }` props as before.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/BranchCombobox.test.tsx` (after the existing "keeps the full list visible..." test, before the closing `});`):

```tsx
  it("ranks substring matches before fuzzy-only matches", () => {
    const rankedBranches = ["moxbxilxe", "mobile", "release/mobile-v2"];
    const { container } = render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={rankedBranches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Jump to branch..."), { target: { value: "mobile" } });
    const names = Array.from(container.querySelectorAll(".row-name")).map((el) => el.textContent);
    expect(names).toEqual(["Any", "mobile", "release/mobile-v2", "moxbxilxe"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- BranchCombobox`
Expected: FAIL — current plain `fuzzyMatch` filtering preserves original array order, so the rendered order is `["Any", "moxbxilxe", "mobile", "release/mobile-v2"]`, not the expected ranked order.

- [ ] **Step 3: Use `rankMatches`**

In `src/components/BranchCombobox.tsx`, change the import and the `filtered` computation:

```tsx
import { fuzzyMatch, rankMatches } from "../lib/fuzzyMatch";
```

```tsx
  const filtered = rankMatches(filterText, branches, (b) => b);
```

(`fuzzyMatch` itself is no longer used directly in this file after this change — remove it from the import if nothing else in the file references it. Checking the file: it isn't used elsewhere, so the import becomes `import { rankMatches } from "../lib/fuzzyMatch";`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- BranchCombobox`
Expected: PASS — all tests green, including the new ranking test.

---

### Task 3: Rank branches in `BranchTree`

**Files:**
- Modify: `src/components/BranchTree.tsx`
- Modify: `src/__tests__/BranchTree.test.tsx`

**Interfaces:**
- Consumes: `rankMatches` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/BranchTree.test.tsx` (after the existing "shows an inline error when tag checkout fails" test, before the closing `});`):

```tsx
  it("ranks local branches with substring matches before fuzzy-only matches", async () => {
    const { useSearchStore } = await import("../store/searchStore");
    useWorkspaceStore.setState({
      branches: [
        { name: "moxbxilxe", isRemote: false, isHead: false, targetOid: "a" },
        { name: "mobile", isRemote: false, isHead: false, targetOid: "a" },
        { name: "release/mobile-v2", isRemote: false, isHead: false, targetOid: "a" },
      ],
    });
    const { container } = render(<BranchTree />);
    act(() => {
      useSearchStore.setState({ query: "mobile" });
    });
    const names = Array.from(container.querySelectorAll("[data-head] span")).map((el) => el.textContent);
    expect(names).toEqual(["mobile", "release/mobile-v2", "moxbxilxe"]);
    act(() => {
      useSearchStore.setState({ query: "" });
    });
  });
```

(Remotes stays collapsed by default and this test doesn't click its header, so `[data-head]` only matches the local-branches rows — the remote-branch container never renders.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- BranchTree`
Expected: FAIL — current plain `fuzzyMatch` filtering renders `["moxbxilxe", "mobile", "release/mobile-v2"]` in original order.

- [ ] **Step 3: Use `rankMatches`**

In `src/components/BranchTree.tsx`, change the import and the `local`/`remote` computations:

```tsx
import { fuzzyMatch, rankMatches } from "../lib/fuzzyMatch";
```

```tsx
  const local = rankMatches(query, branches.filter((b) => !b.isRemote), (b) => b.name);
  const remote = rankMatches(query, branches.filter((b) => b.isRemote), (b) => b.name);
```

(`fuzzyMatch` is still used directly for `filteredTags` on the next line, so keep it in the import alongside `rankMatches`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- BranchTree`
Expected: PASS — all tests green, including the new ranking test.

---

### Task 4: `DateRangeFilter` component

**Files:**
- Create: `src/components/DateRangeFilter.tsx`
- Test: `src/__tests__/DateRangeFilter.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export default function DateRangeFilter(props: { value: string | undefined; onChange: (value: string | null) => void }): JSX.Element`, consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/DateRangeFilter.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DateRangeFilter from "../components/DateRangeFilter";

describe("DateRangeFilter", () => {
  beforeEach(() => {
    // Fixed at noon UTC so the local calendar date is "2026-07-21" across
    // any realistic timezone offset (see Global Constraints on date math).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 'Any' when no value is set", () => {
    render(<DateRangeFilter value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("Any");
  });

  it("shows a range summary when both From and To are set", () => {
    render(<DateRangeFilter value="2026-07-01..2026-07-15" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("2026-07-01 → 2026-07-15");
  });

  it("shows a from-only summary", () => {
    render(<DateRangeFilter value=">=2026-07-01" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("From 2026-07-01");
  });

  it("shows a to-only summary", () => {
    render(<DateRangeFilter value="<=2026-07-15" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("Until 2026-07-15");
  });

  it("clicking Today sets both From and To to today", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Today"));
    expect(onChange).toHaveBeenCalledWith("2026-07-21..2026-07-21");
  });

  it("clicking Last 7 days sets a 7-day range ending today", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Last 7 days"));
    expect(onChange).toHaveBeenCalledWith("2026-07-15..2026-07-21");
  });

  it("clicking Last 30 days sets a 30-day range ending today", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Last 30 days"));
    expect(onChange).toHaveBeenCalledWith("2026-06-22..2026-07-21");
  });

  it("clicking This month sets a range from the 1st of the month to today", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("This month"));
    expect(onChange).toHaveBeenCalledWith("2026-07-01..2026-07-21");
  });

  it("editing the From input calls onChange with a from-only value when To is empty", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-07-01" } });
    expect(onChange).toHaveBeenCalledWith(">=2026-07-01");
  });

  it("editing the To input calls onChange with a to-only value when From is empty", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-07-15" } });
    expect(onChange).toHaveBeenCalledWith("<=2026-07-15");
  });

  it("combines an existing From with a newly-set To into a range", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value=">=2026-07-01" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-07-15" } });
    expect(onChange).toHaveBeenCalledWith("2026-07-01..2026-07-15");
  });

  it("shows a Clear button when a value is set, which calls onChange(null)", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value="2026-07-01..2026-07-15" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows no Clear button when no value is set", () => {
    render(<DateRangeFilter value={undefined} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <DateRangeFilter value={undefined} onChange={vi.fn()} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Today")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- DateRangeFilter`
Expected: FAIL — `Cannot find module '../components/DateRangeFilter'`.

- [ ] **Step 3: Write the component**

Create `src/components/DateRangeFilter.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

interface DateRangeFilterProps {
  value: string | undefined;
  onChange: (value: string | null) => void;
}

function isoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

const PRESETS: { label: string; compute: () => { from: string; to: string } }[] = [
  {
    label: "Today",
    compute: () => {
      const today = isoDate(new Date());
      return { from: today, to: today };
    },
  },
  {
    label: "Last 7 days",
    compute: () => ({ from: isoDate(daysAgo(6)), to: isoDate(new Date()) }),
  },
  {
    label: "Last 30 days",
    compute: () => ({ from: isoDate(daysAgo(29)), to: isoDate(new Date()) }),
  },
  {
    label: "This month",
    compute: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: isoDate(first), to: isoDate(now) };
    },
  },
];

function parseRange(value: string | undefined): { from: string; to: string } {
  if (!value) return { from: "", to: "" };
  if (value.includes("..")) {
    const [from, to] = value.split("..");
    return { from, to };
  }
  if (value.startsWith(">=")) return { from: value.slice(2), to: "" };
  if (value.startsWith("<=")) return { from: "", to: value.slice(2) };
  return { from: "", to: "" };
}

function buildValue(from: string, to: string): string | null {
  if (from && to) return `${from}..${to}`;
  if (from) return `>=${from}`;
  if (to) return `<=${to}`;
  return null;
}

function summarize(value: string | undefined): string {
  const { from, to } = parseRange(value);
  if (from && to) return `${from} → ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return "Any";
}

export default function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { from, to } = parseRange(value);

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

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="w-32 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary text-left truncate"
        onClick={() => setIsOpen((o) => !o)}
      >
        {summarize(value)}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-64 bg-elevated border border-border-subtle rounded-lg shadow-lg p-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  const { from: f, to: t } = p.compute();
                  onChange(buildValue(f, t));
                }}
                className="px-2 py-0.5 rounded text-[11px] bg-hover text-text-primary hover:bg-accent-soft"
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => onChange(buildValue(e.target.value, to))}
              className="bg-elevated border border-border-subtle rounded px-1 py-0.5 text-text-primary"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => onChange(buildValue(from, e.target.value))}
              className="bg-elevated border border-border-subtle rounded px-1 py-0.5 text-text-primary"
            />
          </label>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="self-start text-[11px] text-text-muted hover:text-danger"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- DateRangeFilter`
Expected: PASS — all 14 tests green.

---

### Task 5: Wire `DateRangeFilter` into `PullRequestsScreen`

**Files:**
- Modify: `src/components/PullRequestsScreen.tsx`
- Modify: `src/__tests__/PullRequestsScreen.test.tsx`

**Interfaces:**
- Consumes: `DateRangeFilter` from Task 4 (`{ value, onChange }`), `getQualifier`/`setQualifier` (existing, unchanged).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/PullRequestsScreen.test.tsx` (after the existing "selecting a head branch updates the qualifier query" test):

```tsx
  it("selecting the Today preset under Created sets the created qualifier", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Created"));
    fireEvent.click(screen.getByText("Today"));
    expect(useGithubStore.getState().query).toBe("created:2026-07-21..2026-07-21");
    vi.useRealTimers();
  });

  it("selecting the Today preset under Updated sets the updated qualifier", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Updated"));
    fireEvent.click(screen.getByText("Today"));
    expect(useGithubStore.getState().query).toBe("updated:2026-07-21..2026-07-21");
    vi.useRealTimers();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- PullRequestsScreen`
Expected: FAIL — no "Created"/"Updated" labeled fields exist yet in the filter bar.

- [ ] **Step 3: Wire the component**

In `src/components/PullRequestsScreen.tsx`, add the import:

```tsx
import DateRangeFilter from "./DateRangeFilter";
```

Insert two new fields right after the Milestone `<input>` and before the Base branch `<label>`:

```tsx
        <label className="flex items-center gap-1 text-text-muted">
          Created
          <DateRangeFilter value={getQualifier(query, "created")} onChange={(v) => setQualifier("created", v)} />
        </label>
        <label className="flex items-center gap-1 text-text-muted">
          Updated
          <DateRangeFilter value={getQualifier(query, "updated")} onChange={(v) => setQualifier("updated", v)} />
        </label>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- PullRequestsScreen`
Expected: PASS — all tests green, including the two new ones.

- [ ] **Step 5: Run the full test suite and type check**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — every suite green except the pre-existing, unrelated `Toolbar.test.tsx` "Push" failure (out of scope, flagged in prior rounds); no TypeScript errors.

---

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — no commit steps in this plan; each task's changes are simply saved to disk.
