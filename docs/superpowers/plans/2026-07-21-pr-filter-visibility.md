# PR Filter Bar Add/Remove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every one of the 12 PR filter-bar fields be individually hidden/shown, persisted across restarts, defaulting to Created/Updated/Base branch/Head branch/State/Sort visible and the other six (Author, Label, Assignee, Reviewer, Project, Milestone) hidden.

**Architecture:** A small localStorage-backed helper (`visibleFilters.ts`, same shape as the existing `recentBranches.ts`) holds the visible-key list. `PullRequestsScreen.tsx` becomes data-driven: a `FILTER_DEFS` array (key + label, in the existing fixed bar order) is filtered by the visible-key list and rendered via a `renderFilterControl(key)` switch that reproduces each field's exact existing markup — a pure refactor of what's already there, not new field behavior. A new `FilterVisibilityMenu` popover (structured like `BranchCombobox`/`DateRangeFilter`) lists all 12 as checkboxes to toggle visibility; each visible field also gets its own small **×** button as a sibling of its `<label>` (not nested inside it, to avoid two labelable elements sharing one wrapping `<label>`).

**Tech Stack:** React 18 + TypeScript, Zustand (unchanged), Tailwind CSS, Vitest + @testing-library/react. No new dependencies.

## Global Constraints

- This project is intentionally not tracked in git (explicit prior decision — no `git init`/`git add`/`git commit`; each task ends by running tests, not committing).
- Every remove/toggle-off must clear the field's own qualifier from the query (except `state`, which clears via the existing `handleStateChange("")` since it manages two token keys, `is`/`state`, together).
- A per-field **×** button must be a sibling of its `<label>`, never nested inside it — nesting two labelable elements (the field's own input/select and the button) inside one wrapping `<label>` is ambiguous for implicit label association and would break `getByLabelText` queries.
- `FILTER_DEFS`'s array order is the only source of display order — visible fields are always `FILTER_DEFS.filter(...)`, never re-ordered by when they were toggled on.

---

### Task 1: `visibleFilters.ts` localStorage helper

**Files:**
- Create: `src/lib/visibleFilters.ts`
- Test: `src/__tests__/visibleFilters.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DEFAULT_VISIBLE_FILTERS: string[]`, `getVisibleFilters(): string[]`, `setVisibleFilters(keys: string[]): void`, all consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/visibleFilters.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { getVisibleFilters, setVisibleFilters, DEFAULT_VISIBLE_FILTERS } from "../lib/visibleFilters";

describe("visibleFilters", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the defaults when nothing has been stored", () => {
    expect(getVisibleFilters()).toEqual(DEFAULT_VISIBLE_FILTERS);
  });

  it("round-trips a custom set", () => {
    setVisibleFilters(["author", "sort"]);
    expect(getVisibleFilters()).toEqual(["author", "sort"]);
  });

  it("falls back to the defaults when localStorage holds corrupt data", () => {
    localStorage.setItem("bettertree.visibleFilters", "{not json");
    expect(getVisibleFilters()).toEqual(DEFAULT_VISIBLE_FILTERS);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- visibleFilters`
Expected: FAIL — `Cannot find module '../lib/visibleFilters'`.

- [ ] **Step 3: Write the helper**

Create `src/lib/visibleFilters.ts`:

```ts
const STORAGE_KEY = "bettertree.visibleFilters";

export const DEFAULT_VISIBLE_FILTERS: string[] = ["created", "updated", "base", "head", "state", "sort"];

export function getVisibleFilters(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [...DEFAULT_VISIBLE_FILTERS];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
      ? parsed
      : [...DEFAULT_VISIBLE_FILTERS];
  } catch {
    return [...DEFAULT_VISIBLE_FILTERS];
  }
}

export function setVisibleFilters(keys: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- visibleFilters`
Expected: PASS — all 3 tests green.

---

### Task 2: `FilterVisibilityMenu` component

**Files:**
- Create: `src/components/FilterVisibilityMenu.tsx`
- Test: `src/__tests__/FilterVisibilityMenu.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export default function FilterVisibilityMenu(props: { filters: { key: string; label: string }[]; visible: string[]; onToggle: (key: string) => void }): JSX.Element`, consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/FilterVisibilityMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterVisibilityMenu from "../components/FilterVisibilityMenu";

const filters = [
  { key: "author", label: "Author" },
  { key: "sort", label: "Sort" },
];

describe("FilterVisibilityMenu", () => {
  it("opens a popover listing every filter as a checkbox with the right checked state", () => {
    render(<FilterVisibilityMenu filters={filters} visible={["sort"]} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByLabelText("Author")).not.toBeChecked();
    expect(screen.getByLabelText("Sort")).toBeChecked();
  });

  it("calls onToggle with the clicked filter's key", () => {
    const onToggle = vi.fn();
    render(<FilterVisibilityMenu filters={filters} visible={["sort"]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Author"));
    expect(onToggle).toHaveBeenCalledWith("author");
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <FilterVisibilityMenu filters={filters} visible={["sort"]} onToggle={vi.fn()} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByLabelText("Author")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByLabelText("Author")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- FilterVisibilityMenu`
Expected: FAIL — `Cannot find module '../components/FilterVisibilityMenu'`.

- [ ] **Step 3: Write the component**

Create `src/components/FilterVisibilityMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

interface FilterDef {
  key: string;
  label: string;
}

interface FilterVisibilityMenuProps {
  filters: FilterDef[];
  visible: string[];
  onToggle: (key: string) => void;
}

export default function FilterVisibilityMenu({ filters, visible, onToggle }: FilterVisibilityMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        className="px-2 py-1 rounded border border-border-subtle text-text-muted hover:text-text-primary hover:border-accent flex items-center gap-1"
        onClick={() => setIsOpen((o) => !o)}
      >
        <SlidersHorizontal size={12} />
        Filters
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-48 bg-elevated border border-border-subtle rounded-lg shadow-lg p-1">
          {filters.map((f) => (
            <label
              key={f.key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary hover:bg-accent-soft"
            >
              <input type="checkbox" checked={visible.includes(f.key)} onChange={() => onToggle(f.key)} />
              {f.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- FilterVisibilityMenu`
Expected: PASS — all 3 tests green.

---

### Task 3: Wire filter visibility into `PullRequestsScreen`

**Files:**
- Modify: `src/components/PullRequestsScreen.tsx`
- Modify: `src/__tests__/PullRequestsScreen.test.tsx`

**Interfaces:**
- Consumes: `getVisibleFilters`/`setVisibleFilters` from Task 1, `FilterVisibilityMenu` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/PullRequestsScreen.test.tsx`, replace the existing `"typing in the author filter updates the qualifier query"` test (Author now starts hidden, so it must be added via the Filters menu first):

```tsx
  it("typing in the author filter updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Author"));
    fireEvent.change(screen.getByPlaceholderText("Author"), { target: { value: "yarinmag" } });
    expect(useGithubStore.getState().query).toBe("author:yarinmag");
  });
```

Then add these new tests (anywhere after it):

```tsx
  it("shows only the default filters by default", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText("Author")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Label")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Assignee")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Reviewer")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Project")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Milestone")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Created")).toBeInTheDocument();
    expect(screen.getByLabelText("Updated")).toBeInTheDocument();
    expect(screen.getByLabelText("Base branch")).toBeInTheDocument();
    expect(screen.getByLabelText("Head branch")).toBeInTheDocument();
    expect(screen.getByLabelText("State")).toBeInTheDocument();
    expect(screen.getByLabelText("Sort")).toBeInTheDocument();
  });

  it("removing the Sort filter clears its qualifier and hides the field", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "created-desc" } });
    expect(useGithubStore.getState().query).toBe("sort:created-desc");
    fireEvent.click(screen.getByRole("button", { name: "Remove Sort filter" }));
    expect(useGithubStore.getState().query).toBe("");
    expect(screen.queryByLabelText("Sort")).not.toBeInTheDocument();
  });

  it("removing the State filter resets it to Open (clears is:/state: qualifiers)", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "closed" } });
    expect(useGithubStore.getState().query).toBe("is:closed");
    fireEvent.click(screen.getByRole("button", { name: "Remove State filter" }));
    expect(useGithubStore.getState().query).toBe("");
    expect(screen.queryByLabelText("State")).not.toBeInTheDocument();
  });

  it("adding Author via the Filters menu shows it", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText("Author")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Author"));
    expect(screen.getByPlaceholderText("Author")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- PullRequestsScreen`
Expected: FAIL — no "Filters" button exists yet, all 12 fields still always render (Author etc. aren't hidden), no per-field remove buttons exist.

- [ ] **Step 3: Refactor the component**

Replace the full contents of `src/components/PullRequestsScreen.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { getQualifier } from "../lib/qualifierQuery";
import { getVisibleFilters, setVisibleFilters } from "../lib/visibleFilters";
import BranchCombobox from "./BranchCombobox";
import DateRangeFilter from "./DateRangeFilter";
import FilterVisibilityMenu from "./FilterVisibilityMenu";

const SORT_OPTIONS = [
  { value: "created-desc", label: "Newest" },
  { value: "created-asc", label: "Oldest" },
  { value: "comments-desc", label: "Most commented" },
  { value: "comments-asc", label: "Least commented" },
  { value: "updated-desc", label: "Recently updated" },
];

const STATE_OPTIONS = [
  { value: "", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
  { value: "all", label: "Any" },
];

const FILTER_DEFS: { key: string; label: string }[] = [
  { key: "author", label: "Author" },
  { key: "label", label: "Label" },
  { key: "assignee", label: "Assignee" },
  { key: "review-requested", label: "Reviewer" },
  { key: "project", label: "Project" },
  { key: "milestone", label: "Milestone" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
  { key: "base", label: "Base branch" },
  { key: "head", label: "Head branch" },
  { key: "state", label: "State" },
  { key: "sort", label: "Sort" },
];

function getStateValue(query: string): string {
  if (getQualifier(query, "state") === "all") return "all";
  const is = getQualifier(query, "is");
  return is === "closed" || is === "merged" ? is : "";
}

export default function PullRequestsScreen() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const {
    query,
    setQuery,
    setQualifier,
    status,
    pullRequests,
    isLoadingPrs,
    searchPullRequests,
    openPullRequest,
    branches,
    isLoadingBranches,
    loadBranches,
  } = useGithubStore();

  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [openError, setOpenError] = useState<string | null>(null);
  const [visibleFilterKeys, setVisibleFilterKeys] = useState<string[]>(() => getVisibleFilters());

  useEffect(() => {
    if (activeRepo && (!status || status.available)) {
      searchPullRequests(activeRepo.path);
      loadBranches(activeRepo.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepo?.path, status?.available]);

  if (status && !status.available) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-text-muted p-4 text-center">
        {status.reason}
      </div>
    );
  }

  const handleSearch = () => {
    if (!activeRepo) return;
    searchPullRequests(activeRepo.path);
  };

  const handleStateChange = (value: string) => {
    if (value === "all") {
      setQualifier("is", null);
      setQualifier("state", "all");
    } else if (value === "closed" || value === "merged") {
      setQualifier("state", null);
      setQualifier("is", value);
    } else {
      setQualifier("state", null);
      setQualifier("is", null);
    }
  };

  const addFilter = (key: string) => {
    setVisibleFilterKeys((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      setVisibleFilters(next);
      return next;
    });
  };

  const removeFilter = (key: string) => {
    if (key === "state") {
      handleStateChange("");
    } else {
      setQualifier(key, null);
    }
    setVisibleFilterKeys((prev) => {
      const next = prev.filter((k) => k !== key);
      setVisibleFilters(next);
      return next;
    });
  };

  const toggleFilter = (key: string) => {
    if (visibleFilterKeys.includes(key)) {
      removeFilter(key);
    } else {
      addFilter(key);
    }
  };

  const handleRowClick = async (number: number) => {
    if (!activeRepo) return;
    setOpenError(null);
    try {
      await openPullRequest(activeRepo.path, number);
    } catch (e) {
      setOpenError(String(e));
    }
  };

  const renderFilterControl = (key: string) => {
    switch (key) {
      case "author":
        return (
          <input
            className="w-28 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
            placeholder="Author"
            defaultValue={getQualifier(query, "author") ?? ""}
            onChange={(e) => setQualifier("author", e.target.value || null)}
          />
        );
      case "label":
        return (
          <input
            className="w-28 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
            placeholder="Label"
            defaultValue={getQualifier(query, "label") ?? ""}
            onChange={(e) => setQualifier("label", e.target.value || null)}
          />
        );
      case "assignee":
        return (
          <input
            className="w-28 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
            placeholder="Assignee"
            defaultValue={getQualifier(query, "assignee") ?? ""}
            onChange={(e) => setQualifier("assignee", e.target.value || null)}
          />
        );
      case "review-requested":
        return (
          <input
            className="w-28 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
            placeholder="Reviewer"
            defaultValue={getQualifier(query, "review-requested") ?? ""}
            onChange={(e) => setQualifier("review-requested", e.target.value || null)}
          />
        );
      case "project":
        return (
          <input
            className="w-24 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
            placeholder="Project"
            defaultValue={getQualifier(query, "project") ?? ""}
            onChange={(e) => setQualifier("project", e.target.value || null)}
          />
        );
      case "milestone":
        return (
          <input
            className="w-24 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
            placeholder="Milestone"
            defaultValue={getQualifier(query, "milestone") ?? ""}
            onChange={(e) => setQualifier("milestone", e.target.value || null)}
          />
        );
      case "created":
        return (
          <DateRangeFilter value={getQualifier(query, "created")} onChange={(v) => setQualifier("created", v)} />
        );
      case "updated":
        return (
          <DateRangeFilter value={getQualifier(query, "updated")} onChange={(v) => setQualifier("updated", v)} />
        );
      case "base":
        return (
          <BranchCombobox
            value={getQualifier(query, "base")}
            onChange={(v) => setQualifier("base", v)}
            branches={branches}
            isLoading={isLoadingBranches}
          />
        );
      case "head":
        return (
          <BranchCombobox
            value={getQualifier(query, "head")}
            onChange={(v) => setQualifier("head", v)}
            branches={branches}
            isLoading={isLoadingBranches}
          />
        );
      case "state":
        return (
          <select
            className="px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary"
            value={getStateValue(query)}
            onChange={(e) => handleStateChange(e.target.value)}
          >
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "sort":
        return (
          <select
            className="px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary"
            value={getQualifier(query, "sort") ?? ""}
            onChange={(e) => setQualifier("sort", e.target.value || null)}
          >
            <option value="">Default</option>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border-subtle text-xs">
        <input
          className="flex-1 min-w-40 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
          placeholder="is:open author:..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {FILTER_DEFS.filter((f) => visibleFilterKeys.includes(f.key)).map((f) => (
          <span key={f.key} className="flex items-center gap-1">
            <label className="flex items-center gap-1 text-text-muted">
              {f.label}
              {renderFilterControl(f.key)}
            </label>
            <button
              type="button"
              onClick={() => removeFilter(f.key)}
              aria-label={`Remove ${f.label} filter`}
              className="text-text-muted hover:text-danger"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <FilterVisibilityMenu filters={FILTER_DEFS} visible={visibleFilterKeys} onToggle={toggleFilter} />
        <button
          className="px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50 flex items-center gap-1"
          onClick={handleSearch}
          disabled={!activeRepo || isLoadingPrs}
        >
          {isLoadingPrs && <Loader2 size={12} className="animate-spin" />}
          Search
        </button>
        {openError && <span className="text-danger truncate">{openError}</span>}
      </div>
      <div className="flex-1 overflow-y-auto">
        {pullRequests.map((pr) => (
          <div
            key={pr.number}
            onClick={() => handleRowClick(pr.number)}
            className="px-3 py-2 border-b border-border-subtle cursor-pointer hover:bg-hover flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="font-medium truncate text-text-primary">{pr.title}</div>
              <div className="text-text-muted text-xs truncate" data-testid="pr-row-detail">
                #{pr.number} by {pr.author} · {pr.baseRefName} ← {pr.headRefName} · {pr.state}
                {pr.isDraft ? " (draft)" : ""}
                {pr.labels.length > 0 ? ` · ${pr.labels.join(", ")}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- PullRequestsScreen`
Expected: PASS — all tests green, including the new visibility tests and the updated Author test.

- [ ] **Step 5: Run the full suite and type check**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — every suite green except the pre-existing, unrelated `Toolbar.test.tsx` "Push" failure (flagged in prior rounds, out of scope); no TypeScript errors.

---

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — no commit steps in this plan; each task's changes are simply saved to disk.
