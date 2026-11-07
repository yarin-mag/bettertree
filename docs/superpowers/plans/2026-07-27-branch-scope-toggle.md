# Branch Scope Toggle + Sidebar Separators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single global "Show remote branches" toggle that controls whether remote-tracking branches are considered in the sidebar's branch tree and the Compare screen's ref pickers — plus a visual divider between the sidebar's Branches/Remotes/Tags sections.

**Architecture:** New `branchScopeStore.ts` (localStorage-persisted, mirrors `themeStore.ts`'s exact pattern) holds the single boolean. `BranchTree.tsx` reads it to fully omit the Remotes section (not just collapse it) and renders a checkbox + dividers. `CompareScreen.tsx` reads it to filter `workspaceStore.branches` before flattening to names for `RefCombobox`. The PR screen's branch filter is untouched — its list is GitHub-API-sourced and has no local/remote concept.

**Tech Stack:** Zustand, React + TypeScript, Tailwind, Vitest + Testing Library.

## Global Constraints

- This project is **not under git version control** — never run `git init`/`add`/`commit`/`branch`. Every task ends with running tests, not a commit step.
- No new dependencies.
- Reference spec: `docs/superpowers/specs/2026-07-27-branch-scope-toggle-design.md`.

---

### Task 1: `branchScopeStore`

**Files:**
- Create: `src/store/branchScopeStore.ts`
- Test: `src/__tests__/branchScopeStore.test.ts`

**Interfaces:**
- Produces: `useBranchScopeStore` with `{ showRemoteBranches: boolean; toggleShowRemoteBranches: () => void }` — Task 2 (`BranchTree.tsx`) and Task 3 (`CompareScreen.tsx`) both consume this exact shape.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/branchScopeStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useBranchScopeStore } from "../store/branchScopeStore";

describe("branchScopeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useBranchScopeStore.setState({ showRemoteBranches: true });
  });

  it("defaults to showing remote branches", () => {
    expect(useBranchScopeStore.getState().showRemoteBranches).toBe(true);
  });

  it("toggleShowRemoteBranches flips false and back to true", () => {
    useBranchScopeStore.getState().toggleShowRemoteBranches();
    expect(useBranchScopeStore.getState().showRemoteBranches).toBe(false);
    useBranchScopeStore.getState().toggleShowRemoteBranches();
    expect(useBranchScopeStore.getState().showRemoteBranches).toBe(true);
  });

  it("persists the choice to localStorage", () => {
    useBranchScopeStore.getState().toggleShowRemoteBranches();
    expect(localStorage.getItem("branchScope.showRemoteBranches")).toBe("false");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run src/__tests__/branchScopeStore.test.ts`
Expected: FAIL — `Cannot find module '../store/branchScopeStore'`.

- [ ] **Step 3: Implement `branchScopeStore.ts`**

Create `src/store/branchScopeStore.ts`:

```ts
import { create } from "zustand";

interface BranchScopeState {
  showRemoteBranches: boolean;
  toggleShowRemoteBranches: () => void;
}

function applyShowRemoteBranches(value: boolean) {
  localStorage.setItem("branchScope.showRemoteBranches", String(value));
}

function initialShowRemoteBranches(): boolean {
  return localStorage.getItem("branchScope.showRemoteBranches") !== "false";
}

export const useBranchScopeStore = create<BranchScopeState>((set, get) => ({
  showRemoteBranches: initialShowRemoteBranches(),
  toggleShowRemoteBranches: () => {
    const next = !get().showRemoteBranches;
    applyShowRemoteBranches(next);
    set({ showRemoteBranches: next });
  },
}));
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx vitest run src/__tests__/branchScopeStore.test.ts`
Expected: all 3 tests PASS.

---

### Task 2: Sidebar — hide-entirely toggle + section dividers

**Files:**
- Modify: `src/components/BranchTree.tsx`
- Modify: `src/__tests__/BranchTree.test.tsx`

**Interfaces:**
- Consumes: `useBranchScopeStore` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/BranchTree.test.tsx`, add the import and reset (alongside the existing imports/`beforeEach`):

```tsx
import { useBranchScopeStore } from "../store/branchScopeStore";
```

Add `useBranchScopeStore.setState({ showRemoteBranches: true });` as the first line inside the existing `beforeEach`'s body (before the `useWorkspaceStore.setState` call).

Add these tests at the end of the `describe` block, before the closing `});`:

```tsx
  it("shows the Show remotes checkbox checked by default and unchecking it hides the Remotes section entirely", () => {
    render(<BranchTree />);
    const checkbox = screen.getByRole("checkbox", { name: "Show remotes" });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    expect(useBranchScopeStore.getState().showRemoteBranches).toBe(false);
  });

  it("does not render the Remotes section at all when showRemoteBranches is false", () => {
    useBranchScopeStore.setState({ showRemoteBranches: false });
    render(<BranchTree />);
    expect(screen.queryByText(/Remotes/)).not.toBeInTheDocument();
    expect(screen.queryByText("origin/main")).not.toBeInTheDocument();
    // Local branches and tags are unaffected.
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });

  it("shows a divider between Branches/Remotes and between Remotes/Tags when remotes are shown", () => {
    render(<BranchTree />);
    expect(screen.getAllByTestId("section-divider")).toHaveLength(2);
  });

  it("shows only one divider (Branches/Tags) when remotes are hidden", () => {
    useBranchScopeStore.setState({ showRemoteBranches: false });
    render(<BranchTree />);
    expect(screen.getAllByTestId("section-divider")).toHaveLength(1);
  });
```

- [ ] **Step 2: Run to confirm the new tests fail**

Run: `npx vitest run src/__tests__/BranchTree.test.tsx`
Expected: the 4 new tests FAIL (no checkbox, no `section-divider` test ids exist yet); the pre-existing tests still PASS unchanged.

- [ ] **Step 3: Implement the checkbox, conditional Remotes section, and dividers**

Replace the full contents of `src/components/BranchTree.tsx`:

```tsx
import { useState } from "react";
import { GitBranch, Tag as TagIcon, ChevronDown, ChevronRight } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { useBranchScopeStore } from "../store/branchScopeStore";
import { fuzzyMatch, rankMatches } from "../lib/fuzzyMatch";

function SectionDivider() {
  return (
    <div
      data-testid="section-divider"
      className="h-px my-2"
      style={{ background: "linear-gradient(to right, transparent, var(--border-subtle), transparent)" }}
    />
  );
}

export default function BranchTree() {
  const { branches, tags, repos, activeRepoId, switchBranch, checkoutTag, headDetached, headOid } =
    useWorkspaceStore();
  const { query } = useSearchStore();
  const { showRemoteBranches, toggleShowRemoteBranches } = useBranchScopeStore();
  const [error, setError] = useState<string | null>(null);
  const [remotesCollapsed, setRemotesCollapsed] = useState(true);
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const local = rankMatches(query, branches.filter((b) => !b.isRemote), (b) => b.name);
  const remote = rankMatches(query, branches.filter((b) => b.isRemote), (b) => b.name);
  const filteredTags = tags.filter((t) => fuzzyMatch(query, t.name));

  const handleSwitch = async (branchName: string, isRemote: boolean) => {
    setError(null);
    try {
      await switchBranch(activeRepo?.path as string, branchName, isRemote);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCheckoutTag = async (tagName: string) => {
    setError(null);
    try {
      await checkoutTag(activeRepo?.path as string, tagName);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="text-sm p-2">
      <div className="flex items-center justify-between mt-2">
        <div className="text-xs uppercase text-text-muted">Branches</div>
        <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showRemoteBranches}
            onChange={toggleShowRemoteBranches}
            aria-label="Show remotes"
          />
          Show remotes
        </label>
      </div>
      {error && <div className="text-xs text-danger px-2 py-0.5">{error}</div>}
      {headDetached && (
        <div className="text-xs text-text-muted px-2 py-0.5 italic">
          Detached @ {tags.find((t) => t.targetOid === headOid)?.name ?? headOid?.slice(0, 7)}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto">
        {local.map((b) => (
          <div
            key={b.name}
            data-head={b.isHead}
            onDoubleClick={() => handleSwitch(b.name, false)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer ${
              b.isHead ? "bg-accent-soft text-accent font-medium" : "text-text-primary"
            }`}
          >
            <GitBranch size={12} />
            <span>{b.name}</span>
          </div>
        ))}
      </div>
      <SectionDivider />
      {showRemoteBranches && (
        <>
          <button
            type="button"
            className="flex items-center gap-1 w-full text-left text-xs uppercase text-text-muted hover:text-text-primary"
            onClick={() => setRemotesCollapsed((c) => !c)}
          >
            {remotesCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            Remotes ({remote.length})
          </button>
          {!remotesCollapsed && (
            <div className="max-h-40 overflow-y-auto">
              {remote.map((b) => (
                <div
                  key={b.name}
                  data-head={b.isHead}
                  onDoubleClick={() => handleSwitch(b.name, true)}
                  className="flex items-center gap-1.5 px-2 py-0.5 text-text-muted cursor-pointer"
                >
                  <GitBranch size={12} />
                  <span>{b.name}</span>
                </div>
              ))}
            </div>
          )}
          <SectionDivider />
        </>
      )}
      <div className="text-xs uppercase text-text-muted">Tags</div>
      <div className="max-h-40 overflow-y-auto">
        {filteredTags.map((t) => (
          <div
            key={t.name}
            onDoubleClick={() => handleCheckoutTag(t.name)}
            className="flex items-center gap-1.5 px-2 py-0.5 text-text-primary cursor-pointer"
          >
            <TagIcon size={12} />
            <span>{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm all tests pass**

Run: `npx vitest run src/__tests__/BranchTree.test.tsx`
Expected: all tests PASS (14 pre-existing + 4 new = 18).

---

### Task 3: Compare screen respects the toggle

**Files:**
- Modify: `src/components/CompareScreen.tsx`
- Modify: `src/__tests__/CompareScreen.test.tsx`

**Interfaces:**
- Consumes: `useBranchScopeStore` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/CompareScreen.test.tsx`, add the import (alongside the existing store imports):

```tsx
import { useBranchScopeStore } from "../store/branchScopeStore";
```

Add `useBranchScopeStore.setState({ showRemoteBranches: true });` to the existing `beforeEach`, after the `useCompareStore.setState(...)` call.

Add these two tests at the end of the `describe` block:

```tsx
  it("excludes remote branches from the ref pickers when showRemoteBranches is false", () => {
    useBranchScopeStore.setState({ showRemoteBranches: false });
    useWorkspaceStore.setState({
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "a" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
      ],
    });
    render(<CompareScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText("origin/main")).not.toBeInTheDocument();
  });

  it("includes remote branches in the ref pickers when showRemoteBranches is true", () => {
    useBranchScopeStore.setState({ showRemoteBranches: true });
    useWorkspaceStore.setState({
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "a" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
      ],
    });
    render(<CompareScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to confirm the new tests fail**

Run: `npx vitest run src/__tests__/CompareScreen.test.tsx`
Expected: the "excludes remote branches..." test FAILS (both `main` and `origin/main` currently render regardless of the toggle, since `CompareScreen` doesn't consult `branchScopeStore` yet); the "includes remote branches..." test already passes coincidentally (current code always includes everything) but will be re-verified after the change.

- [ ] **Step 3: Filter branches by the toggle**

In `src/components/CompareScreen.tsx`, add the import:

```tsx
import { useBranchScopeStore } from "../store/branchScopeStore";
```

Change:

```tsx
  const { activeRepoId, repos, branches, tags } = useWorkspaceStore();
  const { baseRef, compareRef, result, isLoading, error, setBaseRef, setCompareRef, loadCompare } = useCompareStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [direction, setDirection] = useState<CompareDirection>("both");

  const branchNames = branches.map((b) => b.name);
  const tagNames = tags.map((t) => t.name);
```

to:

```tsx
  const { activeRepoId, repos, branches, tags } = useWorkspaceStore();
  const { baseRef, compareRef, result, isLoading, error, setBaseRef, setCompareRef, loadCompare } = useCompareStore();
  const { showRemoteBranches } = useBranchScopeStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [direction, setDirection] = useState<CompareDirection>("both");

  const branchNames = branches.filter((b) => showRemoteBranches || !b.isRemote).map((b) => b.name);
  const tagNames = tags.map((t) => t.name);
```

- [ ] **Step 4: Run to confirm all tests pass**

Run: `npx vitest run src/__tests__/CompareScreen.test.tsx`
Expected: all tests PASS (8 pre-existing + 2 new = 10).

- [ ] **Step 5: Full regression + typecheck**

Run: `npx vitest run`
Expected: all tests pass, zero failures other than the pre-existing unrelated `Toolbar.test.tsx` "Push" failure.

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Visual verification**

Following this project's established pattern (Playwright against `npm run dev` with a mocked `window.__TAURI_INTERNALS__.invoke`): open the sidebar with a repo that has both local and remote branches, screenshot with the checkbox checked (dividers + Remotes section visible) and unchecked (Remotes section gone, single divider), and screenshot the Compare screen's ref picker with the checkbox off to confirm remote branches are excluded there too. Clean up temp files and kill the dev server afterward.

**No commit** — this project is not git-tracked (see Global Constraints).
