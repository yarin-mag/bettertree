# Nest UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Bettertree to the approved "Nest" (GitHub-familiar) direction and restructure its chrome from 4 stacked bars into a consolidated header + sidebar nav, per `docs/superpowers/specs/2026-07-22-nest-ui-redesign-design.md`.

**Architecture:** Pure frontend render-layer change. No IPC/store data-shape changes. Work proceeds file-by-file in dependency order: tokens first (everything else renders through them), then the two chrome relocations (view tabs, theme toggle) out of `Toolbar` into `Sidebar`, then `Toolbar`'s own restyle, then `SearchBar` scoping, then `PullRequestsScreen`'s row visuals and state-filter control.

**Tech Stack:** React + TypeScript, Tailwind (semantic color tokens via CSS custom properties), Zustand, Vitest + Testing Library.

## Global Constraints

- **No git in this project** (`Is a git repository: false`, confirmed with the user previously) — every task ends with running the relevant test file(s), not a commit. Skip all `git add`/`git commit` steps from the standard task template.
- No backend/Rust changes, no store data-shape changes (spec "Out of Scope").
- Preserve every existing test selector not explicitly called out below as changing: `"+ Add repo"`, `"Fetch"`, `"Pull"`, `data-testid="pr-row-detail"` (and its exact text format), filter chip labels/placeholders, `"Search branches, tags, commits…"`, the `BranchTree` `[data-head]`+`<span>` convention.
- One pre-existing, unrelated test failure exists today and is out of scope: `Toolbar.test.tsx`'s `"shows an error banner when push fails"` test clicks a `"Push"` button that is already commented out of `Toolbar.tsx`'s JSX (predates this plan). Baseline before this plan: **178 passed / 1 failed, 179 total, 30 test files** (verified by running `npx vitest run`). Do not fix this failure as part of this plan — it isn't caused by, or related to, any task here.
- Run `npx vitest run <file>` (not the interactive watcher) for every "run the test" step below.

---

### Task 1: Nest design tokens

**Files:**
- Modify: `src/index.css:5-37` (both `:root[data-theme]` blocks)
- Modify: `tailwind.config.js:6-21` (the `colors` map)

**Interfaces:**
- Produces: CSS custom properties `--merged`, `--merged-soft-bg` (new); existing `--accent`/`--success`/`--danger`/etc. keep their names, only values change. Tailwind semantic classes `text-merged`, `bg-merged`, `bg-merged-soft` become available for Task 6.

No dedicated test for this task — it's a pure token-value swap with no new logic. The deliverable is verified by re-running the full suite and confirming it matches the baseline exactly (no new failures introduced by the value change).

- [ ] **Step 1: Replace the two token blocks in `src/index.css`**

Replace lines 5-37 with:

```css
:root[data-theme="dark"] {
  --bg-canvas: #0d1117;
  --bg-surface: #161b22;
  --bg-elevated: #1c232c;
  --bg-hover: #1c2733;
  --border-subtle: #30363d;
  --text-primary: #e6edf3;
  --text-muted: #8b949e;
  --accent: #3fb96a;
  --accent-contrast: #04170c;
  --accent-soft-bg: rgba(63, 185, 106, 0.15);
  --success: #3fb950;
  --danger: #f85149;
  --merged: #a371f7;
  --success-soft-bg: rgba(63, 185, 80, 0.15);
  --danger-soft-bg: rgba(248, 81, 73, 0.15);
  --merged-soft-bg: rgba(163, 113, 247, 0.16);
}

:root[data-theme="light"] {
  --bg-canvas: #ffffff;
  --bg-surface: #f6f8fa;
  --bg-elevated: #eef1f4;
  --bg-hover: #eaeef2;
  --border-subtle: #d0d7de;
  --text-primary: #1f2328;
  --text-muted: #59636e;
  --accent: #1a7f37;
  --accent-contrast: #ffffff;
  --accent-soft-bg: rgba(26, 127, 55, 0.10);
  --success: #1a7f37;
  --danger: #cf222e;
  --merged: #8250df;
  --success-soft-bg: rgba(26, 127, 55, 0.10);
  --danger-soft-bg: rgba(207, 34, 46, 0.10);
  --merged-soft-bg: rgba(130, 80, 223, 0.12);
}
```

- [ ] **Step 2: Add `merged` colors to `tailwind.config.js`**

Replace the `colors: { ... }` block (lines 6-21) with:

```js
      colors: {
        canvas: "var(--bg-canvas)",
        surface: "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
        hover: "var(--bg-hover)",
        "border-subtle": "var(--border-subtle)",
        "text-primary": "var(--text-primary)",
        "text-muted": "var(--text-muted)",
        accent: "var(--accent)",
        "accent-contrast": "var(--accent-contrast)",
        "accent-soft": "var(--accent-soft-bg)",
        success: "var(--success)",
        danger: "var(--danger)",
        "success-soft": "var(--success-soft-bg)",
        "danger-soft": "var(--danger-soft-bg)",
        merged: "var(--merged)",
        "merged-soft": "var(--merged-soft-bg)",
      },
```

- [ ] **Step 3: Run the full suite and confirm the baseline is unchanged**

Run: `npx vitest run`
Expected: `1 failed | 178 passed (179)` across `30` test files — identical to the documented baseline (the one failure is the pre-existing `Toolbar.test.tsx` Push test noted in Global Constraints).

- [ ] **Step 4: No commit** (project is not git-tracked — see Global Constraints). Move to Task 2.

---

### Task 2: Move the Repo/Pull Requests view tabs from `Toolbar` into `Sidebar`

**Files:**
- Modify: `src/components/Toolbar.tsx` (remove the view-tab buttons and `useViewStore` usage)
- Modify: `src/components/Sidebar.tsx` (add a nav row at the top using `useViewStore`)
- Modify: `src/__tests__/Toolbar.test.tsx` (remove the two tab-switch tests)
- Modify: `src/__tests__/Sidebar.test.tsx` (add the two tab-switch tests, relocated)

**Interfaces:**
- Consumes: `useViewStore` — `{ activeView: "repo" | "pulls", setActiveView: (view: "repo" | "pulls") => void }` (`src/store/viewStore.ts`, unchanged).
- Produces: `Sidebar` now renders two buttons with accessible names `"Repo"` and `"Pull Requests"` that call `setActiveView`.

- [ ] **Step 1: Write the failing tests in `Sidebar.test.tsx`**

Replace the full file with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSearchStore } from "../store/searchStore";
import { useViewStore } from "../store/viewStore";

vi.mock("../components/RepoList", () => ({ default: () => <div data-testid="repo-list" /> }));
vi.mock("../components/BranchTree", () => ({ default: () => <div data-testid="branch-tree" /> }));

import Sidebar from "../components/Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    useSearchStore.setState({ isSearchActive: false });
    useViewStore.setState({ activeView: "repo" });
  });

  it("does not render the AdvancedSearch panel inline", () => {
    render(<Sidebar />);
    expect(screen.queryByPlaceholderText("Message or code...")).not.toBeInTheDocument();
  });

  it("switches the view store to pulls when the Pull Requests tab is clicked", () => {
    render(<Sidebar />);
    screen.getByRole("button", { name: "Pull Requests" }).click();
    expect(useViewStore.getState().activeView).toBe("pulls");
  });

  it("switches back to repo when the Repo tab is clicked", () => {
    useViewStore.setState({ activeView: "pulls" });
    render(<Sidebar />);
    screen.getByRole("button", { name: "Repo" }).click();
    expect(useViewStore.getState().activeView).toBe("repo");
  });
});
```

- [ ] **Step 2: Run the test file and verify the two new tests fail**

Run: `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Pull Requests"` (the tabs don't exist in `Sidebar` yet). The first (`AdvancedSearch`) test still passes.

- [ ] **Step 3: Add the nav row to `Sidebar.tsx`**

Replace the full file with:

```tsx
import { useViewStore } from "../store/viewStore";
import RepoList from "./RepoList";
import BranchTree from "./BranchTree";
import ResizeHandle from "./ResizeHandle";
import { useResizable } from "../hooks/useResizable";

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function Sidebar() {
  const { size, onMouseDown } = useResizable(256, MIN_WIDTH, MAX_WIDTH, "x");
  const { activeView, setActiveView } = useViewStore();

  return (
    <div
      className="relative flex-shrink-0 border-r border-border-subtle bg-surface h-full flex flex-col"
      style={{ width: size }}
    >
      <div className="flex items-center gap-1 p-2 border-b border-border-subtle">
        <button
          type="button"
          className={`flex-1 text-xs px-2 py-1 rounded ${
            activeView === "repo" ? "bg-accent text-accent-contrast" : "bg-elevated border border-border-subtle text-text-primary"
          }`}
          onClick={() => setActiveView("repo")}
        >
          Repo
        </button>
        <button
          type="button"
          className={`flex-1 text-xs px-2 py-1 rounded ${
            activeView === "pulls" ? "bg-accent text-accent-contrast" : "bg-elevated border border-border-subtle text-text-primary"
          }`}
          onClick={() => setActiveView("pulls")}
        >
          Pull Requests
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <RepoList />
        <BranchTree />
      </div>
      <ResizeHandle axis="x" edge="end" onMouseDown={onMouseDown} />
    </div>
  );
}
```

(Note: `overflow-y-auto` moved off the outer container onto the new middle wrapper `<div>` so only the repo/branch list scrolls — the nav row above and the footer added in Task 3 stay fixed.)

- [ ] **Step 4: Run the test file and verify all three tests pass**

Run: `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Remove the tabs from `Toolbar.tsx`**

Replace the full file with:

```tsx
import { useState } from "react";
import { RefreshCw, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { invokeFetchRemote, invokePullRemote, invokePushRemote } from "../lib/tauri";
import ThemeToggle from "./ThemeToggle";

export default function Toolbar() {
  const { activeRepoId, repos, setActiveRepo } = useWorkspaceStore();
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const run = async (action: (path: string) => Promise<unknown>, refreshAfter: boolean) => {
    if (!activeRepo) return;
    setError(null);
    try {
      await action(activeRepo.path);
      if (refreshAfter) await setActiveRepo(activeRepo.id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-surface border-b border-border-subtle">
      <button
        className="flex items-center gap-1 text-xs px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary disabled:opacity-50"
        onClick={() => run(invokeFetchRemote, true)}
        disabled={!activeRepo}
      >
        <RefreshCw size={12} /> Fetch
      </button>
      <button
        className="flex items-center gap-1 text-xs px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50"
        onClick={() => run(invokePullRemote, true)}
        disabled={!activeRepo}
      >
        <ArrowDownToLine size={12} /> Pull
      </button>
      {error && <span className="text-xs text-danger truncate">{error}</span>}
      <div className="flex-1" />
      <ThemeToggle />
    </div>
  );
}
```

(This is a transitional state — `ThemeToggle` still lives here; it moves out in Task 3. `ArrowUpFromLine` stays imported/unused-in-JSX for now since the commented-out Push button referencing it is removed in this step; TypeScript will flag the now-unused import. Remove the `ArrowUpFromLine` import too — final import line: `import { RefreshCw, ArrowDownToLine } from "lucide-react";`.)

- [ ] **Step 6: Remove the two relocated tests from `Toolbar.test.tsx`**

Replace the full file with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import Toolbar from "../components/Toolbar";

// setActiveRepo (called by Toolbar's refresh-after-pull/fetch path) also
// calls invokeEnsureSearchIndex internally — it must be mocked here too,
// or that fire-and-forget call throws "not a function" inside the test.
vi.mock("../lib/tauri", () => ({
  invokeFetchRemote: vi.fn(),
  invokePullRemote: vi.fn(),
  invokePushRemote: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
}));

import * as tauriLib from "../lib/tauri";

describe("Toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [],
      tags: [],
      commits: [],
    });
  });

  it("shows an error banner when push fails", async () => {
    (tauriLib.invokePushRemote as any).mockRejectedValue("push rejected: pull first");

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Push" }));

    await waitFor(() => {
      expect(screen.getByText("push rejected: pull first")).toBeInTheDocument();
    });
  });

  it("refreshes branches after a successful pull", async () => {
    (tauriLib.invokePullRemote as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetBranches as any).mockResolvedValue([]);
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));

    await waitFor(() => {
      expect(tauriLib.invokeGetBranches).toHaveBeenCalledWith("/tmp/a");
    });
  });
});
```

(The `"shows an error banner when push fails"` test is the pre-existing, out-of-scope failure from Global Constraints — untouched, still expected to fail here.)

- [ ] **Step 7: Run both test files and confirm the expected state**

Run: `npx vitest run src/__tests__/Toolbar.test.tsx src/__tests__/Sidebar.test.tsx`
Expected: `Sidebar.test.tsx` — 3 passed. `Toolbar.test.tsx` — 1 failed (Push, pre-existing) / 1 passed.

- [ ] **Step 8: No commit.** Move to Task 3.

---

### Task 3: Move `ThemeToggle` and the active repo path into a `Sidebar` footer

**Files:**
- Modify: `src/components/Toolbar.tsx` (remove `<ThemeToggle />` and its import)
- Modify: `src/components/Sidebar.tsx` (add a footer row: repo path + `ThemeToggle`)
- Modify: `src/__tests__/Sidebar.test.tsx` (add a footer test)

**Interfaces:**
- Consumes: `useWorkspaceStore` — `{ activeRepoId: number | null, repos: RepoEntry[] }` where `RepoEntry` has `{ id, path, name, pinned }` (`src/lib/tauri.ts`, unchanged). `ThemeToggle` (`src/components/ThemeToggle.tsx`, unchanged component/props — it's a no-props component).
- Produces: `Sidebar` renders the theme toggle button (accessible name `"Switch to light theme"` / `"Switch to dark theme"`, unchanged from `ThemeToggle.tsx`) and the active repo's filesystem path text.

- [ ] **Step 1: Write the failing test in `Sidebar.test.tsx`**

Add this import at the top (alongside the existing ones):

```tsx
import { useWorkspaceStore } from "../store/workspaceStore";
```

Add this test inside the `describe("Sidebar", ...)` block:

```tsx
  it("shows the active repo path and the theme toggle in the sidebar footer", () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/repo-a", name: "repo-a", pinned: false }],
      activeRepoId: 1,
    });
    render(<Sidebar />);
    expect(screen.getByText("/tmp/repo-a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Switch to (dark|light) theme/ })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test file and verify the new test fails**

Run: `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /tmp/repo-a` (no footer yet).

- [ ] **Step 3: Add the footer to `Sidebar.tsx`**

Replace the full file with:

```tsx
import { useViewStore } from "../store/viewStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import RepoList from "./RepoList";
import BranchTree from "./BranchTree";
import ResizeHandle from "./ResizeHandle";
import ThemeToggle from "./ThemeToggle";
import { useResizable } from "../hooks/useResizable";

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function Sidebar() {
  const { size, onMouseDown } = useResizable(256, MIN_WIDTH, MAX_WIDTH, "x");
  const { activeView, setActiveView } = useViewStore();
  const { activeRepoId, repos } = useWorkspaceStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  return (
    <div
      className="relative flex-shrink-0 border-r border-border-subtle bg-surface h-full flex flex-col"
      style={{ width: size }}
    >
      <div className="flex items-center gap-1 p-2 border-b border-border-subtle">
        <button
          type="button"
          className={`flex-1 text-xs px-2 py-1 rounded ${
            activeView === "repo" ? "bg-accent text-accent-contrast" : "bg-elevated border border-border-subtle text-text-primary"
          }`}
          onClick={() => setActiveView("repo")}
        >
          Repo
        </button>
        <button
          type="button"
          className={`flex-1 text-xs px-2 py-1 rounded ${
            activeView === "pulls" ? "bg-accent text-accent-contrast" : "bg-elevated border border-border-subtle text-text-primary"
          }`}
          onClick={() => setActiveView("pulls")}
        >
          Pull Requests
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <RepoList />
        <BranchTree />
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border-subtle">
        <span className="flex-1 min-w-0 truncate text-xs text-text-muted" title={activeRepo?.path ?? ""}>
          {activeRepo?.path ?? ""}
        </span>
        <ThemeToggle />
      </div>
      <ResizeHandle axis="x" edge="end" onMouseDown={onMouseDown} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test file and verify all four tests pass**

Run: `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Remove `ThemeToggle` from `Toolbar.tsx`**

Replace the full file with:

```tsx
import { useState } from "react";
import { RefreshCw, ArrowDownToLine } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { invokeFetchRemote, invokePullRemote, invokePushRemote } from "../lib/tauri";

export default function Toolbar() {
  const { activeRepoId, repos, setActiveRepo } = useWorkspaceStore();
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const run = async (action: (path: string) => Promise<unknown>, refreshAfter: boolean) => {
    if (!activeRepo) return;
    setError(null);
    try {
      await action(activeRepo.path);
      if (refreshAfter) await setActiveRepo(activeRepo.id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-surface border-b border-border-subtle">
      <button
        className="flex items-center gap-1 text-xs px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary disabled:opacity-50"
        onClick={() => run(invokeFetchRemote, true)}
        disabled={!activeRepo}
      >
        <RefreshCw size={12} /> Fetch
      </button>
      <button
        className="flex items-center gap-1 text-xs px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50"
        onClick={() => run(invokePullRemote, true)}
        disabled={!activeRepo}
      >
        <ArrowDownToLine size={12} /> Pull
      </button>
      {error && <span className="text-xs text-danger truncate">{error}</span>}
      <div className="flex-1" />
    </div>
  );
}
```

(Still transitional — the breadcrumb/count-pill/button-grouping restyle happens in Task 4. `ThemeToggle.test.tsx` needs no changes: it renders `<ThemeToggle />` standalone, insulated from where it's mounted.)

- [ ] **Step 6: Run `Toolbar.test.tsx` and confirm nothing new broke**

Run: `npx vitest run src/__tests__/Toolbar.test.tsx`
Expected: same as Task 2's Step 7 — 1 failed (pre-existing Push) / 1 passed.

- [ ] **Step 7: No commit.** Move to Task 4.

---

### Task 4: Restyle `Toolbar` into the consolidated header

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/__tests__/Toolbar.test.tsx` (add one new test)

**Interfaces:**
- Consumes: `useViewStore` — `{ activeView }` (read-only here, no tab switching). `useGithubStore` — `{ pullRequests: PullRequest[] }` (`src/store/githubStore.ts`, unchanged).
- Produces: no new exports; visual-only change to `Toolbar`'s JSX.

- [ ] **Step 1: Write the failing test in `Toolbar.test.tsx`**

Add these imports at the top:

```tsx
import { useViewStore } from "../store/viewStore";
import { useGithubStore } from "../store/githubStore";
```

Add this test inside the `describe("Toolbar", ...)` block:

```tsx
  it("shows the active repo name, and a result count only in Pull Requests view", () => {
    useViewStore.setState({ activeView: "repo" });
    useGithubStore.setState({ pullRequests: [] });
    const { rerender } = render(<Toolbar />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText(/results?$/)).not.toBeInTheDocument();

    useViewStore.setState({ activeView: "pulls" });
    useGithubStore.setState({ pullRequests: [{ number: 1 }, { number: 2 }] as any });
    rerender(<Toolbar />);
    expect(screen.getByText("2 results")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test file and verify the new test fails**

Run: `npx vitest run src/__tests__/Toolbar.test.tsx`
Expected: FAIL — `Unable to find an element with the text: a` (no breadcrumb yet).

- [ ] **Step 3: Restyle `Toolbar.tsx`**

Replace the full file with:

```tsx
import { useState } from "react";
import { RefreshCw, ArrowDownToLine } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useViewStore } from "../store/viewStore";
import { useGithubStore } from "../store/githubStore";
import { invokeFetchRemote, invokePullRemote, invokePushRemote } from "../lib/tauri";

export default function Toolbar() {
  const { activeRepoId, repos, setActiveRepo } = useWorkspaceStore();
  const { activeView } = useViewStore();
  const { pullRequests } = useGithubStore();
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const run = async (action: (path: string) => Promise<unknown>, refreshAfter: boolean) => {
    if (!activeRepo) return;
    setError(null);
    try {
      await action(activeRepo.path);
      if (refreshAfter) await setActiveRepo(activeRepo.id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border-b border-border-subtle">
      <span className="text-xs font-medium text-text-primary truncate">
        {activeRepo?.name ?? "No repo selected"}
      </span>
      {error && <span className="text-xs text-danger truncate">{error}</span>}
      <div className="flex-1" />
      {activeView === "pulls" && (
        <span className="text-xs text-text-muted [font-variant-numeric:tabular-nums]">
          {pullRequests.length} {pullRequests.length === 1 ? "result" : "results"}
        </span>
      )}
      <div className="flex rounded border border-border-subtle overflow-hidden">
        <button
          className="flex items-center gap-1 text-xs px-2 py-1 bg-elevated text-text-primary disabled:opacity-50"
          onClick={() => run(invokeFetchRemote, true)}
          disabled={!activeRepo}
        >
          <RefreshCw size={12} /> Fetch
        </button>
        <button
          className="flex items-center gap-1 text-xs px-2 py-1 bg-accent text-accent-contrast border-l border-border-subtle disabled:opacity-50"
          onClick={() => run(invokePullRemote, true)}
          disabled={!activeRepo}
        >
          <ArrowDownToLine size={12} /> Pull
        </button>
      </div>
    </div>
  );
}
```

(`invokePushRemote` is still imported so the pre-existing `Toolbar.test.tsx` Push test — out of scope per Global Constraints — keeps its current failure mode unchanged rather than gaining a new "not a function" error; the button itself remains absent from the JSX, same as before this plan.)

- [ ] **Step 4: Run the test file and verify all tests pass except the known pre-existing failure**

Run: `npx vitest run src/__tests__/Toolbar.test.tsx`
Expected: 1 failed (pre-existing Push) / 2 passed.

- [ ] **Step 5: No commit.** Move to Task 5.

---

### Task 5: Scope the global `SearchBar` to non-Pull-Requests views

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/__tests__/App.test.tsx` (add two tests)

**Interfaces:**
- Consumes: `useViewStore` — `{ activeView }` (already imported in `App.tsx`, no change to the store).
- Produces: no new exports; `SearchBar` now renders conditionally.

- [ ] **Step 1: Write the failing tests in `App.test.tsx`**

Add these tests inside the `describe("App", ...)` block:

```tsx
  it("hides the global search bar in the Pull Requests view", () => {
    useViewStore.setState({ activeView: "pulls" });
    render(<App />);
    expect(screen.queryByTestId("search-bar")).not.toBeInTheDocument();
  });

  it("shows the global search bar in the repo view", () => {
    render(<App />);
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test file and verify the first new test fails**

Run: `npx vitest run src/__tests__/App.test.tsx`
Expected: FAIL on `"hides the global search bar in the Pull Requests view"` — `search-bar` is still found (it's unconditional today).

- [ ] **Step 3: Gate `SearchBar` in `App.tsx`**

Replace the `return (...)` block in `src/App.tsx` with:

```tsx
  return (
    <div className="h-screen w-screen flex flex-col bg-canvas text-text-primary">
      <Toolbar />
      {activeView !== "pulls" && <SearchBar />}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        {activeView === "pulls" ? (
          <PullRequestsScreen />
        ) : isSearchActive ? (
          <SearchResultsPane />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <CommitGraph />
            <CommitDrawer />
          </div>
        )}
      </div>
    </div>
  );
```

(Only the `<SearchBar />` line's position/condition changes — moved below `<Toolbar />` and gated on `activeView !== "pulls"`. It intentionally still renders during `isSearchActive` — that state only swaps which panel shows below it, the bar itself keeps editing the same query, so hiding it there would strand the user mid-search.)

- [ ] **Step 4: Run the test file and verify all tests pass**

Run: `npx vitest run src/__tests__/App.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: No commit.** Move to Task 6.

---

### Task 6: PR row visuals — avatar, colored label pills, status badge

**Files:**
- Create: `src/lib/hashColor.ts`
- Test: `src/__tests__/hashColor.test.ts`
- Modify: `src/index.css` (add `.label-pill` rule)
- Modify: `src/components/PullRequestsScreen.tsx` (row rendering only, lines ~298-315 in current source)
- Modify: `src/__tests__/PullRequestsScreen.test.tsx` (add two tests)

**Interfaces:**
- Produces: `hashHue(input: string): number` — deterministic hue in `[0, 360)` for a given string, exported from `src/lib/hashColor.ts`. Consumed by `PullRequestsScreen.tsx` for both author-avatar background color and label-pill `--label-h` custom property.

- [ ] **Step 1: Write the failing test for the hash utility**

Create `src/__tests__/hashColor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashHue } from "../lib/hashColor";

describe("hashHue", () => {
  it("returns a value in [0, 360)", () => {
    expect(hashHue("avery")).toBeGreaterThanOrEqual(0);
    expect(hashHue("avery")).toBeLessThan(360);
  });

  it("is deterministic for the same input", () => {
    expect(hashHue("priya")).toBe(hashHue("priya"));
  });

  it("differs for different inputs", () => {
    expect(hashHue("avery")).not.toBe(hashHue("priya"));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/__tests__/hashColor.test.ts`
Expected: FAIL — `Cannot find module '../lib/hashColor'`

- [ ] **Step 3: Implement `hashHue`**

Create `src/lib/hashColor.ts`:

```ts
/** Deterministic hue (0-359) for a string, so the same author or label name always gets the same color. */
export function hashHue(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 360;
  }
  return hash;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/__tests__/hashColor.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing tests for PR row visuals**

Add this import to `src/__tests__/PullRequestsScreen.test.tsx`:

```tsx
// (no new import needed — screen/render/fireEvent/waitFor already imported)
```

Add these tests inside the `describe("PullRequestsScreen", ...)` block:

```tsx
  it("shows an avatar, label pills, and a status badge on each PR row", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([samplePr]);
    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    });
    expect(screen.getByTitle("yarinmag")).toHaveTextContent("YA");
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByTestId("pr-status-badge")).toHaveTextContent("Open");
  });

  it("shows a Merged badge for a merged PR and a Draft badge for a draft PR", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([
      { ...samplePr, number: 43, state: "MERGED", isDraft: false, title: "Merged one" },
      { ...samplePr, number: 44, state: "OPEN", isDraft: true, title: "Draft one" },
    ]);
    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(screen.getByText("Merged one")).toBeInTheDocument();
    });
    const badges = screen.getAllByTestId("pr-status-badge").map((el) => el.textContent);
    expect(badges).toContain("Merged");
    expect(badges).toContain("Draft");
  });
```

**Correction found during execution:** plain `getByText("Open")`/`getByText("Merged")` collide with the State filter's still-present `<select><option>` text (Task 7, which removes that `<select>`, hasn't run yet at this point) — `getByText` throws a multiple-elements error. Fixed by adding `data-testid="pr-status-badge"` to the status badge span (see Step 8) and asserting through it instead of raw text.

- [ ] **Step 6: Run the test file and verify the two new tests fail**

Run: `npx vitest run src/__tests__/PullRequestsScreen.test.tsx`
Expected: the two new tests FAIL (`Unable to find an element with the title: yarinmag` — no avatar yet); all pre-existing tests in this file still pass.

- [ ] **Step 7: Add the `.label-pill` rule to `src/index.css`**

Append to the end of `src/index.css`:

```css
.label-pill {
  background: hsl(var(--label-h) 60% 92% / 1);
  color: hsl(var(--label-h) 45% 32%);
}
:root[data-theme="dark"] .label-pill {
  background: hsl(var(--label-h) 45% 22% / 1);
  color: hsl(var(--label-h) 65% 78%);
}
```

- [ ] **Step 8: Restyle the PR row rendering in `PullRequestsScreen.tsx`**

Add this import near the top (alongside the other `../lib/...` imports):

```tsx
import { hashHue } from "../lib/hashColor";
```

**Correction found during execution:** this file has no default `React` import (uses the `react-jsx` transform, named imports only), so `React.CSSProperties` in Step 8 below doesn't resolve. Add `type CSSProperties` to the existing `react` import instead: `import { useEffect, useState, type CSSProperties } from "react";`, and use `as CSSProperties` (not `as React.CSSProperties`) in the label-pill `style` cast.

Add these two module-level helper functions above `export default function PullRequestsScreen()` (near `getStateValue`):

```tsx
function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function statusLabel(pr: { state: string; isDraft: boolean }): { label: string; className: string } {
  if (pr.isDraft) return { label: "Draft", className: "bg-elevated border border-border-subtle text-text-muted" };
  switch (pr.state.toUpperCase()) {
    case "MERGED":
      return { label: "Merged", className: "bg-merged-soft text-merged" };
    case "CLOSED":
      return { label: "Closed", className: "bg-danger-soft text-danger" };
    default:
      return { label: "Open", className: "bg-success-soft text-success" };
  }
}
```

Replace the row-rendering block (the `<div className="flex-1 overflow-y-auto">...</div>` at the end of the component) with:

```tsx
      <div className="flex-1 overflow-y-auto">
        {pullRequests.map((pr) => {
          const status = statusLabel(pr);
          return (
            <div
              key={pr.number}
              onClick={() => handleRowClick(pr.number)}
              className="px-3 py-2 border-b border-border-subtle cursor-pointer hover:bg-hover flex items-center gap-3"
            >
              <span
                className="flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold shrink-0 text-white"
                style={{ backgroundColor: `hsl(${hashHue(pr.author)}, 55%, 45%)` }}
                title={pr.author}
              >
                {initials(pr.author)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium truncate text-text-primary">{pr.title}</span>
                  {pr.labels.map((label) => (
                    <span
                      key={label}
                      className="label-pill text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{ "--label-h": hashHue(label) } as CSSProperties}
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <div className="text-text-muted text-xs truncate" data-testid="pr-row-detail">
                  #{pr.number} by {pr.author} · {pr.baseRefName} ← {pr.headRefName} · {pr.state}
                  {pr.isDraft ? " (draft)" : ""}
                  {pr.labels.length > 0 ? ` · ${pr.labels.join(", ")}` : ""}
                </div>
              </div>
              <span
                data-testid="pr-status-badge"
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${status.className}`}
              >
                {status.label}
              </span>
            </div>
          );
        })}
      </div>
```

- [ ] **Step 9: Run the test file and verify all tests pass**

Run: `npx vitest run src/__tests__/PullRequestsScreen.test.tsx`
Expected: PASS (all tests in this file — pre-existing count plus the 2 new ones)

- [ ] **Step 10: No commit.** Move to Task 7.

---

### Task 7: PR state filter — segmented control with Draft support

**Files:**
- Modify: `src/components/PullRequestsScreen.tsx` (`STATE_OPTIONS`, `getStateValue`, `handleStateChange`, the `case "state":` branch of `renderFilterControl`)
- Modify: `src/__tests__/PullRequestsScreen.test.tsx` (rewrite the State-related tests, add one for Draft)

**Interfaces:**
- Produces: the `"state"` filter now renders as a `<div role="group" aria-label="State">` containing one `<button>` per option, each with `aria-pressed` reflecting whether it's the active state. `STATE_OPTIONS` gains a `{ value: "draft", label: "Draft" }` entry; `getStateValue`/`handleStateChange` recognize `is:draft` the same way they recognize `is:closed`/`is:merged`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/PullRequestsScreen.test.tsx`, replace this test:

```tsx
  it("removing the State filter resets it to Open (clears is:/state: qualifiers)", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "closed" } });
    expect(useGithubStore.getState().query).toBe("is:closed");
    fireEvent.click(screen.getByRole("button", { name: "Remove State filter" }));
    expect(useGithubStore.getState().query).toBe("");
    expect(screen.queryByLabelText("State")).not.toBeInTheDocument();
  });
```

with:

```tsx
  it("removing the State filter resets it to Open (clears is:/state: qualifiers)", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(useGithubStore.getState().query).toBe("is:closed");
    fireEvent.click(screen.getByRole("button", { name: "Remove State filter" }));
    expect(useGithubStore.getState().query).toBe("");
    expect(screen.queryByRole("group", { name: "State" })).not.toBeInTheDocument();
  });
```

Replace this line inside `"shows only the default filters by default"`:

```tsx
    expect(screen.getByLabelText("State")).toBeInTheDocument();
```

with:

```tsx
    expect(screen.getByRole("group", { name: "State" })).toBeInTheDocument();
```

Replace this test:

```tsx
  it("defaults the State dropdown to Open", () => {
    render(<PullRequestsScreen />);
    expect(screen.getByLabelText("State")).toHaveValue("");
  });
```

with:

```tsx
  it("defaults the State segmented control to Open", () => {
    render(<PullRequestsScreen />);
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
  });
```

Replace this test:

```tsx
  it("selecting Closed sets an is:closed qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "closed" } });
    expect(useGithubStore.getState().query).toBe("is:closed");
  });
```

with:

```tsx
  it("selecting Closed sets an is:closed qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(useGithubStore.getState().query).toBe("is:closed");
  });

  it("selecting Draft sets an is:draft qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Draft" }));
    expect(useGithubStore.getState().query).toBe("is:draft");
  });
```

Replace this test:

```tsx
  it("selecting Merged sets an is:merged qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "merged" } });
    expect(useGithubStore.getState().query).toBe("is:merged");
  });
```

with:

```tsx
  it("selecting Merged sets an is:merged qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Merged" }));
    expect(useGithubStore.getState().query).toBe("is:merged");
  });
```

Replace this test:

```tsx
  it("selecting Any sets a state:all qualifier and clears any is: qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "closed" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "all" } });
    expect(useGithubStore.getState().query).toBe("state:all");
  });
```

with:

```tsx
  it("selecting Any sets a state:all qualifier and clears any is: qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    fireEvent.click(screen.getByRole("button", { name: "Any" }));
    expect(useGithubStore.getState().query).toBe("state:all");
  });
```

Replace this test:

```tsx
  it("switching back to Open clears the state qualifiers", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "" } });
    expect(useGithubStore.getState().query).toBe("");
  });
```

with:

```tsx
  it("switching back to Open clears the state qualifiers", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Any" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(useGithubStore.getState().query).toBe("");
  });
```

- [ ] **Step 2: Run the test file and verify the rewritten/new tests fail**

Run: `npx vitest run src/__tests__/PullRequestsScreen.test.tsx`
Expected: FAIL on the State-related tests — `getByLabelText("State")`/`getByRole("button", { name: "Closed" })` don't resolve against the current `<select>`.

- [ ] **Step 3: Update `STATE_OPTIONS`, `getStateValue`, `handleStateChange`, and the `"state"` render branch**

Replace:

```tsx
const STATE_OPTIONS = [
  { value: "", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
  { value: "all", label: "Any" },
];
```

with:

```tsx
const STATE_OPTIONS = [
  { value: "", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
  { value: "draft", label: "Draft" },
  { value: "all", label: "Any" },
];
```

Replace:

```tsx
function getStateValue(query: string): string {
  if (getQualifier(query, "state") === "all") return "all";
  const is = getQualifier(query, "is");
  return is === "closed" || is === "merged" ? is : "";
}
```

with:

```tsx
function getStateValue(query: string): string {
  if (getQualifier(query, "state") === "all") return "all";
  const is = getQualifier(query, "is");
  return is === "closed" || is === "merged" || is === "draft" ? is : "";
}
```

Replace:

```tsx
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
```

with:

```tsx
  const handleStateChange = (value: string) => {
    if (value === "all") {
      setQualifier("is", null);
      setQualifier("state", "all");
    } else if (value === "closed" || value === "merged" || value === "draft") {
      setQualifier("state", null);
      setQualifier("is", value);
    } else {
      setQualifier("state", null);
      setQualifier("is", null);
    }
  };
```

Replace the `case "state":` branch inside `renderFilterControl`:

```tsx
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
```

with:

```tsx
      case "state": {
        const current = getStateValue(query);
        return (
          <div role="group" aria-label="State" className="flex rounded border border-border-subtle overflow-hidden">
            {STATE_OPTIONS.map((o, i) => (
              <button
                key={o.value}
                type="button"
                aria-label={o.label}
                aria-pressed={current === o.value}
                className={`px-2 py-1 text-xs ${i > 0 ? "border-l border-border-subtle" : ""} ${
                  current === o.value ? "bg-accent text-accent-contrast" : "bg-elevated text-text-primary"
                }`}
                onClick={() => handleStateChange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        );
      }
```

**Correction found during execution:** the shared `<label>{f.label}{renderFilterControl(f.key)}</label>` wrapper used for every filter only associates with the *first* labelable descendant (per HTML's label-association rule). With five buttons inside one `<label>`, only the first button ("Open") got hijacked into a bogus computed accessible name ("State State" — the label's own text plus the group's `aria-label`, concatenated). Fixed by adding an explicit `aria-label={o.label}` to every segmented button (shown above) — matches the existing convention already used by `BranchCombobox`/`UserCombobox` in this same file for controls nested inside these generic label wrappers.

**Second correction found during execution:** `getByRole("button", { name: "Any" })` collides with the *Base branch* and *Head branch* filters' `BranchCombobox` trigger buttons, which also default to the accessible name `"Any"` when unselected (`BranchCombobox.tsx:72`, `aria-label={value ?? "Any"}`) — both are visible by default alongside State. The two tests exercising the "Any" state (`"selecting Any sets a state:all qualifier..."` and `"switching back to Open..."`) need to scope their queries to the state group: add `import { within } from "@testing-library/react"` (alongside the existing named imports) and, in each of those two tests, replace the bare `screen.getByRole("button", { name: ... })` calls with `within(screen.getByRole("group", { name: "State" })).getByRole("button", { name: ... })` (capture the group once as `const stateGroup = screen.getByRole("group", { name: "State" });` at the top of each test). The other State tests (Open/Closed/Merged/Draft) don't need scoping — those names are unique page-wide.

- [ ] **Step 4: Run the test file and verify everything passes**

Run: `npx vitest run src/__tests__/PullRequestsScreen.test.tsx`
Expected: PASS (all tests, including the rewritten State tests and the new Draft test)

- [ ] **Step 5: No commit.** Move to Task 8.

---

### Task 8: Full regression

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend suite**

Run: `npx vitest run`
Expected: `1 failed | <baseline + new tests added> passed` — the only failure is the pre-existing `Toolbar.test.tsx` Push test from Global Constraints. No other failures.

- [ ] **Step 2: Run the Rust backend suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass — this plan makes no backend changes, so this is a pure regression check.

- [ ] **Step 3: Run the e2e suite**

Run: `npm run e2e`
Expected: all pass. If any e2e test asserts on the old Toolbar-hosted view tabs, Fetch/Push/Pull button locations, or the old `<select>`-based State filter, update its selectors to match this plan's changes (tab buttons now under the sidebar's nav row; State filter now a button group under `role="group" name="State"`) rather than reverting the UI change.

- [ ] **Step 4: No commit** — this plan's work is complete once all three suites are green (with only the documented pre-existing Push-test exception in the Vitest run).

**Findings from execution:** `npx vitest run` finished at 188 passed / 1 failed (189 total, 31 files) — the 1 failure is the documented pre-existing Push test. `cargo test` — 82/82 passed. `npm run e2e` had 3 failures, all confirmed pre-existing and unrelated to this plan (reproduced independently against the running dev server with console/pageerror logging, not assumed):
- `workingcopy.spec.ts` expects `WorkingCopyPanel` content (`new.txt`, Stage button) that's already commented out of `Sidebar.tsx` — predates this plan.
- `workspace.spec.ts` and `search.spec.ts` both throw `Cannot read properties of undefined (reading 'filter')` inside `BranchTree.tsx` immediately after repo selection, which unmounts the whole app (React uncaught-render-error) and cascades into both specs' later assertions timing out. Root cause: `e2e/mockTauri.ts`'s `get_branches` case returns a bare `BranchInfo[]` array, but `workspaceStore.ts`'s `refreshActiveRepoData` (line 61) does `branches: branchResult.branches` — it expects `{ branches, headDetached, headOid }`. Neither `e2e/mockTauri.ts` nor `workspaceStore.ts` nor `BranchTree.tsx` were touched by any task in this plan — this is a stale mock/backend-contract mismatch that predates this work. Left unfixed as out of scope; flagged to the user for a separate fix.
