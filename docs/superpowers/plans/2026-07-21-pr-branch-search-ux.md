# PR Branch Filters + Search Entry-Point Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake "Base branch" datalist filter in the PR search panel with a real searchable branch combobox, add a matching "Head branch" filter, and relocate/relabel the buried commit-history search trigger so it reads as a distinct feature from the top search bar.

**Architecture:** One new presentational component (`BranchCombobox`) is shared by both the Base and Head branch filters in `PullRequestsScreen`. It manages its own open/filter/highlight state locally and reports selections via `onChange(value: string | null)`, so the parent just wires it to the existing `setQualifier` calls — no store changes needed. Separately, the commit-history search trigger moves from a button buried at the bottom of `Sidebar` to an icon button next to the top `SearchBar`, with no change to the search logic itself (`useSearchStore().activateSearch`).

**Tech Stack:** React 18 + TypeScript, Zustand (state, unchanged), Tailwind CSS, Vitest + @testing-library/react, lucide-react icons. No new dependencies.

## Global Constraints

- This project is intentionally not tracked in git (explicit prior decision — do not run `git init`/`git add`/`git commit` at any point in this plan; each task ends with running tests, not committing).
- No new npm dependencies — `package.json` has no headless-UI library (no Radix/cmdk/downshift); the combobox is hand-built to match the app's existing plain-Tailwind-input style.
- Tests live under `src/__tests__/`, not co-located with components (existing convention — see `PullRequestsScreen.test.tsx`, `Sidebar.test.tsx`).
- Reuse `fuzzyMatch(query: string, target: string): boolean` from `src/lib/fuzzyMatch.ts` for all branch filtering — do not write a new matcher.
- lucide-react icons are imported as named imports: `import { IconName } from "lucide-react"`.
- `useGithubStore().branches` is `string[]` (plain branch names) — already loaded via `loadBranches(activeRepo.path)` in `PullRequestsScreen`'s existing `useEffect`; no new loading logic needed.
- `setQualifier(key: string, value: string | null)` (from `useGithubStore`, backed by `src/lib/qualifierQuery.ts`) already supports arbitrary keys — `head:` needs zero backend/query-building change.

---

### Task 1: `BranchCombobox` component

**Files:**
- Create: `src/components/BranchCombobox.tsx`
- Test: `src/__tests__/BranchCombobox.test.tsx`

**Interfaces:**
- Consumes: `fuzzyMatch(query: string, target: string): boolean` from `../lib/fuzzyMatch`.
- Produces: `export default function BranchCombobox(props: { value: string | undefined; onChange: (value: string | null) => void; branches: string[] }): JSX.Element` — used by Task 2 for both the Base and Head branch filters. Accessible name comes from the parent wrapping it in a `<label>` (buttons are natively labelable elements), matching the existing `Sort` field's pattern in `PullRequestsScreen.tsx` — no `label` prop needed on the component itself.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/BranchCombobox.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BranchCombobox from "../components/BranchCombobox";

const branches = ["main", "develop", "feature/foo"];

describe("BranchCombobox", () => {
  it("shows 'Any' when no value is selected", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    expect(screen.getByRole("button")).toHaveTextContent("Any");
  });

  it("shows the selected value on the trigger", () => {
    render(<BranchCombobox value="develop" onChange={vi.fn()} branches={branches} />);
    expect(screen.getByRole("button")).toHaveTextContent("develop");
  });

  it("opens a popover listing all branches on click", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    branches.forEach((b) => expect(screen.getByText(b)).toBeInTheDocument());
  });

  it("filters the list as the user types", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Filter branches..."), { target: { value: "dev" } });
    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("calls onChange and closes when a branch is clicked", () => {
    const onChange = vi.fn();
    render(<BranchCombobox value={undefined} onChange={onChange} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("develop"));
    expect(onChange).toHaveBeenCalledWith("develop");
    expect(screen.queryByPlaceholderText("Filter branches...")).not.toBeInTheDocument();
  });

  it("calls onChange(null) when 'Any' is clicked", () => {
    const onChange = vi.fn();
    render(<BranchCombobox value="develop" onChange={onChange} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Any"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selects the highlighted row on Enter", () => {
    const onChange = vi.fn();
    render(<BranchCombobox value={undefined} onChange={onChange} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByPlaceholderText("Filter branches...");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("main");
  });

  it("closes without calling onChange on Escape", () => {
    const onChange = vi.fn();
    render(<BranchCombobox value={undefined} onChange={onChange} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(screen.getByPlaceholderText("Filter branches..."), { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Filter branches...")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByPlaceholderText("Filter branches...")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByPlaceholderText("Filter branches...")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- BranchCombobox`
Expected: FAIL — `Cannot find module '../components/BranchCombobox'` (component doesn't exist yet).

- [ ] **Step 3: Write the component**

Create `src/components/BranchCombobox.tsx`:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { fuzzyMatch } from "../lib/fuzzyMatch";

interface BranchComboboxProps {
  value: string | undefined;
  onChange: (value: string | null) => void;
  branches: string[];
}

export default function BranchCombobox({ value, onChange, branches }: BranchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = branches.filter((b) => fuzzyMatch(filterText, b));
  const rows: (string | null)[] = [null, ...filtered];

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

  useEffect(() => {
    if (isOpen) {
      setFilterText("");
      setHighlightedIndex(0);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const selectRow = (row: string | null) => {
    onChange(row);
    setIsOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectRow(rows[highlightedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="w-32 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary text-left truncate"
        onClick={() => setIsOpen((o) => !o)}
      >
        {value ?? "Any"}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-48 bg-elevated border border-border-subtle rounded shadow-lg">
          <input
            ref={inputRef}
            className="w-full px-2 py-1 bg-transparent border-b border-border-subtle outline-none text-text-primary"
            placeholder="Filter branches..."
            value={filterText}
            onChange={(e) => {
              setFilterText(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="max-h-48 overflow-y-auto">
            {rows.map((row, i) => (
              <div
                key={row ?? "__any__"}
                onClick={() => selectRow(row)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`px-2 py-1 cursor-pointer truncate ${
                  i === highlightedIndex ? "bg-hover" : ""
                } ${row === null ? "text-text-muted" : "text-text-primary"}`}
              >
                {row ?? "Any"}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- BranchCombobox`
Expected: PASS — all 9 tests green.

---

### Task 2: Wire `BranchCombobox` into `PullRequestsScreen`

**Files:**
- Modify: `src/components/PullRequestsScreen.tsx:109-123`
- Modify: `src/__tests__/PullRequestsScreen.test.tsx`

**Interfaces:**
- Consumes: `BranchCombobox` from Task 1 (`{ value, onChange, branches }`), `getQualifier`/`setQualifier` (existing, unchanged), `branches` from `useGithubStore()` (existing, unchanged).
- Produces: no new exports — this is a leaf usage.

- [ ] **Step 1: Update the failing/changed tests**

In `src/__tests__/PullRequestsScreen.test.tsx`, replace the test named `"fetches all GitHub branches on mount and offers them as datalist options"` with:

```tsx
  it("fetches all GitHub branches on mount and offers them in the branch combobox", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(tauriLib.invokeListGithubBranches).toHaveBeenCalledWith("/tmp/a");
    });
    await waitFor(() => {
      expect(useGithubStore.getState().branches).toContain("feature/foo");
    });
    fireEvent.click(screen.getByLabelText("Base branch"));
    expect(screen.getByText("feature/foo")).toBeInTheDocument();
  });
```

Replace the test named `"typing a base branch updates the qualifier query"` with:

```tsx
  it("selecting a base branch updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Base branch"));
    fireEvent.click(screen.getByText("develop"));
    expect(useGithubStore.getState().query).toBe("base:develop");
  });

  it("selecting a head branch updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Head branch"));
    fireEvent.click(screen.getByText("develop"));
    expect(useGithubStore.getState().query).toBe("head:develop");
  });
```

Leave every other existing test in this file unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- PullRequestsScreen`
Expected: FAIL — `getByLabelText("Base branch")` finds the old text input (not a combobox button), so `getByText("develop")` after the click won't find a popover row; `getByLabelText("Head branch")` finds nothing (field doesn't exist yet).

- [ ] **Step 3: Update the component**

In `src/components/PullRequestsScreen.tsx`, add the import:

```tsx
import BranchCombobox from "./BranchCombobox";
```

Replace lines 109–123 (the old `<label>Base branch<input .../><datalist>...` block) with:

```tsx
        <label className="flex items-center gap-1 text-text-muted">
          Base branch
          <BranchCombobox
            value={getQualifier(query, "base")}
            onChange={(v) => setQualifier("base", v)}
            branches={branches}
          />
        </label>
        <label className="flex items-center gap-1 text-text-muted">
          Head branch
          <BranchCombobox
            value={getQualifier(query, "head")}
            onChange={(v) => setQualifier("head", v)}
            branches={branches}
          />
        </label>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- PullRequestsScreen`
Expected: PASS — all tests green, including the two new/updated ones.

---

### Task 3: Relocate the commit-history search trigger to `SearchBar`

**Files:**
- Modify: `src/components/SearchBar.tsx`
- Test: `src/__tests__/SearchBar.test.tsx` (new file — none exists today)

**Interfaces:**
- Consumes: `useSearchStore().activateSearch: () => void` (existing, unchanged).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/SearchBar.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSearchStore } from "../store/searchStore";
import SearchBar from "../components/SearchBar";

describe("SearchBar", () => {
  beforeEach(() => {
    useSearchStore.setState({ query: "", isSearchActive: false });
  });

  it("renders the live-filter input", () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText("Search branches, tags, commits...")).toBeInTheDocument();
  });

  it("updates the live-filter query as the user types", () => {
    render(<SearchBar />);
    fireEvent.change(screen.getByPlaceholderText("Search branches, tags, commits..."), {
      target: { value: "main" },
    });
    expect(useSearchStore.getState().query).toBe("main");
  });

  it("activates commit-history search when the history button is clicked", () => {
    render(<SearchBar />);
    fireEvent.click(screen.getByRole("button", { name: "Search commit history" }));
    expect(useSearchStore.getState().isSearchActive).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- SearchBar`
Expected: FAIL — `getByRole("button", { name: "Search commit history" })` finds nothing (button doesn't exist yet).

- [ ] **Step 3: Update the component**

Replace `src/components/SearchBar.tsx` in full with:

```tsx
import { Search, History } from "lucide-react";
import { useSearchStore } from "../store/searchStore";

export default function SearchBar() {
  const { query, setQuery, activateSearch } = useSearchStore();
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface border-b border-border-subtle">
      <Search size={14} className="text-text-muted shrink-0" />
      <input
        className="flex-1 bg-elevated border border-border-subtle rounded px-2 py-1 text-sm text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Search branches, tags, commits..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button
        type="button"
        title="Search commit history"
        aria-label="Search commit history"
        className="p-1.5 rounded text-text-muted hover:bg-hover hover:text-text-primary shrink-0"
        onClick={activateSearch}
      >
        <History size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- SearchBar`
Expected: PASS — all 3 tests green.

---

### Task 4: Remove the old search trigger from `Sidebar`

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/__tests__/Sidebar.test.tsx`

**Interfaces:**
- Consumes: none new.
- Produces: none new — this task only removes code. Depends on Task 3 already giving users a way to reach commit-history search (do this task after Task 3, not before, so search is never unreachable mid-plan).

- [ ] **Step 1: Update the test**

In `src/__tests__/Sidebar.test.tsx`, remove the test named `"activates search when the Search trigger is clicked"` (that behavior moved to `SearchBar.test.tsx` in Task 3). Leave the `"does not render the AdvancedSearch panel inline"` test and the `beforeEach` as-is — the resulting file should read:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSearchStore } from "../store/searchStore";

vi.mock("../components/RepoList", () => ({ default: () => <div data-testid="repo-list" /> }));
vi.mock("../components/BranchTree", () => ({ default: () => <div data-testid="branch-tree" /> }));

import Sidebar from "../components/Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    useSearchStore.setState({ isSearchActive: false });
  });

  it("does not render the AdvancedSearch panel inline", () => {
    render(<Sidebar />);
    expect(screen.queryByPlaceholderText("Message or code...")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify the remaining test still passes and the removed one is gone**

Run: `npm test -- Sidebar`
Expected: PASS — 1 test (previously 2); no test references the removed button.

- [ ] **Step 3: Update the component**

Replace `src/components/Sidebar.tsx` in full with:

```tsx
import RepoList from "./RepoList";
import BranchTree from "./BranchTree";
// import WorkingCopyPanel from "./WorkingCopyPanel";
import ResizeHandle from "./ResizeHandle";
import { useResizable } from "../hooks/useResizable";

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function Sidebar() {
  const { size, onMouseDown } = useResizable(256, MIN_WIDTH, MAX_WIDTH, "x");

  return (
    <div
      className="relative flex-shrink-0 border-r border-border-subtle bg-surface h-full overflow-y-auto flex flex-col"
      style={{ width: size }}
    >
      <RepoList />
      <BranchTree />
      {/* <WorkingCopyPanel /> — hidden until Staged/Changes split is designed */}
      <ResizeHandle axis="x" edge="end" onMouseDown={onMouseDown} />
    </div>
  );
}
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS — all suites green, including `Sidebar`, `SearchBar`, `PullRequestsScreen`, and `BranchCombobox`.

---

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — no commit steps in this plan; each task's changes are simply saved to disk.
