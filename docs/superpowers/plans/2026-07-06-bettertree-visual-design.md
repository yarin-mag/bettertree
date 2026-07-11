# Bettertree Visual Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Actually wire up Tailwind (never configured despite being a devDependency since Plan 1) and restyle the whole app into the approved dark-first amber-accent developer-tool look, with a persisted light theme toggle.

**Architecture:** CSS custom properties for semantic design tokens, switched by a `data-theme` attribute on `<html>`; Tailwind's config maps utility class names to those variables so components use plain Tailwind classes. A Zustand `themeStore` plus `ThemeToggle` component handle switching after mount; an inline script in `index.html` sets the initial theme before first paint to avoid a flash.

**Tech Stack:** Tailwind CSS (finally configured), PostCSS, `lucide-react` (new), Zustand (existing).

**Relationship to spec:** Implements `docs/superpowers/specs/2026-07-06-bettertree-visual-design.md` in full. **One resolved inconsistency, found during planning:** the spec's Component Restyle section says to add a `Plus` icon to the "+ Add repo" button, but its own "Not changing" list protects the exact button name `"+ Add repo"` (used by all three existing Playwright specs). Adding an icon there would either duplicate the "+" visually (icon + literal "+" text) or change the accessible name and require editing three passing e2e specs for a purely cosmetic change. Resolution: **no icon on the "Add repo" button** — its text stays exactly `"+ Add repo"`, unchanged. Every other icon placement in this plan adds an icon *alongside* existing text (never replacing tested text), except the `BranchTree` HEAD marker, which the spec explicitly calls out as the one authorized exception (verified: no test asserts on the `"* "` text, only the `data-head` attribute).

## Global Constraints

- Do not change any button `name`, input `placeholder`, or `data-testid` currently asserted on by a test — verified list: button names `"+ Add repo"`, `"Stage"`, `"Unstage"`, `"Commit"`, `"Search history"`, `"Fetch"`, `"Pull"`, `"Push"`, `"Unified"`, `"Side-by-side"`; placeholders `"Commit message"`, `"Message or code..."`, `"Author"`, `"Search branches, tags, commits..."`; `data-testid`s `commit-row`, `commit-dot`, `search-hit`. Icons are added alongside these, not instead of them (one exception: `BranchTree`'s `"* "` HEAD prefix, replaced by styling — no test depends on that text).
- No git version control for this project — no commits, ever. Every task's last step is "mark task complete."
- Backend (`src-tauri/`) is untouched by this plan — purely frontend.
- After every task, run the full test suite (`npm test`, and `npm run e2e` + `cargo test` at the very end) to confirm no regressions — per the established cross-phase testing policy.

---

## File Structure

```
bettertree/
  package.json          # MODIFY: add postcss, autoprefixer, lucide-react
  tailwind.config.js     # NEW: semantic color tokens mapped to CSS vars
  postcss.config.js       # NEW: tailwindcss + autoprefixer pipeline
  index.html               # MODIFY: inline theme-init script
  src/
    index.css               # NEW: @tailwind directives + light/dark token values
    main.tsx                  # MODIFY: import "./index.css"
    store/
      themeStore.ts             # NEW: theme state, toggle, persistence
    components/
      ThemeToggle.tsx            # NEW: sun/moon toggle button
      App.tsx                      # MODIFY: bg-canvas/text-primary root
      SearchBar.tsx                  # MODIFY: restyle + Search icon
      Toolbar.tsx                      # MODIFY: restyle + icons + ThemeToggle
      Sidebar.tsx                        # MODIFY: restyle
      RepoList.tsx                        # MODIFY: restyle (no icon — see header note)
      BranchTree.tsx                        # MODIFY: restyle + branch/tag icons
      WorkingCopyPanel.tsx                    # MODIFY: restyle + stage/unstage icons
      AdvancedSearch.tsx                        # MODIFY: restyle
      CommitGraph.tsx                             # MODIFY: restyle
      CommitGraphRow.tsx                            # MODIFY: glow dot, restyle
      CommitDrawer.tsx                                # MODIFY: restyle + X icon close
      DiffViewer.tsx                                    # MODIFY: segmented control restyle
    __tests__/
      themeStore.test.ts                                  # NEW
      ThemeToggle.test.tsx                                  # NEW
```

`themeStore.ts` owns theme state and persistence only — it doesn't know about any component. `ThemeToggle.tsx` is the only component that calls `toggleTheme()`; every other component just reads Tailwind classes that resolve through CSS variables, with zero theme-awareness of their own.

---

### Task 1: Real Tailwind setup and design tokens

**Files:**
- Modify: `package.json`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `src/index.css`
- Modify: `src/main.tsx`
- Modify: `index.html`

**Interfaces:**
- Consumes: nothing.
- Produces: working Tailwind compilation; CSS custom properties `--bg-canvas`, `--bg-surface`, `--bg-elevated`, `--bg-hover`, `--border-subtle`, `--text-primary`, `--text-muted`, `--accent`, `--accent-contrast`, `--accent-soft-bg`, `--success`, `--danger` for both `[data-theme="dark"]` and `[data-theme="light"]`; Tailwind utility classes `bg-canvas`, `bg-surface`, `bg-elevated`, `bg-hover`, `border-border-subtle` (Tailwind's `border-{color}` convention), `text-text-primary`, `text-text-muted`, `bg-accent`, `text-accent`, `text-accent-contrast`, `bg-accent-soft`, `text-success`, `text-danger`. Every later task in this plan uses these exact class names.

No unit test for this task — it's build/config plumbing. Verified by inspecting the actual compiled CSS output, which is the only way to confirm Tailwind is really running (unit tests can't see computed styles in jsdom).

- [ ] **Step 1: Add the missing devDependencies**

Modify `package.json` — add `postcss`, `autoprefixer` to `devDependencies`, and `lucide-react` to `dependencies` (needed starting Task 2, adding now so one `npm install` covers this whole plan):

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "lucide-react": "^0.460.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.0",
    "@tauri-apps/cli": "^2",
    "@testing-library/dom": "^10",
    "@testing-library/jest-dom": "^6",
    "@testing-library/react": "^16",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4",
    "autoprefixer": "^10.4.0",
    "jsdom": "^25",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

(keep the existing `"scripts"` block unchanged — only `dependencies`/`devDependencies` change)

- [ ] **Step 2: Create the Tailwind and PostCSS configs**

`tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
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
      },
    },
  },
  plugins: [],
};
```

`postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create the token stylesheet**

`src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root[data-theme="dark"] {
  --bg-canvas: #121316;
  --bg-surface: #17181c;
  --bg-elevated: #1e1f24;
  --bg-hover: #1a1b20;
  --border-subtle: #26272c;
  --text-primary: #d3d4da;
  --text-muted: #6f7078;
  --accent: #e8973a;
  --accent-contrast: #1a1200;
  --accent-soft-bg: rgba(232, 151, 58, 0.12);
  --success: #4ad999;
  --danger: #f0625f;
}

:root[data-theme="light"] {
  --bg-canvas: #ffffff;
  --bg-surface: #fafafa;
  --bg-elevated: #f2f2f4;
  --bg-hover: #f7f7f8;
  --border-subtle: #e4e4e7;
  --text-primary: #26272c;
  --text-muted: #9a9aa3;
  --accent: #d97a1f;
  --accent-contrast: #ffffff;
  --accent-soft-bg: rgba(217, 122, 31, 0.10);
  --success: #1a9c63;
  --danger: #d64545;
}

body {
  margin: 0;
  background-color: var(--bg-canvas);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

- [ ] **Step 4: Import the stylesheet and add the flash-prevention script**

Modify `src/main.tsx`:

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Modify `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Bettertree</title>
    <script>
      (function () {
        var stored = localStorage.getItem("theme");
        document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Install and verify Tailwind is actually compiling**

Run: `npm install`
Expected: installs without error.

Run: `npm run build`
Expected: build succeeds.

Run: `grep -c "bg-canvas\|--bg-canvas" dist/assets/*.css`
Expected: a non-zero count — proof the compiled CSS file contains our token-mapped utility classes (this is the only way to verify Tailwind actually ran, since `npm test` runs in jsdom and can't see real computed CSS).

- [ ] **Step 6: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 2: Theme store and toggle

**Files:**
- Create: `src/store/themeStore.ts`
- Create: `src/__tests__/themeStore.test.ts`
- Create: `src/components/ThemeToggle.tsx`
- Create: `src/__tests__/ThemeToggle.test.tsx`

**Interfaces:**
- Consumes: `data-theme` attribute set by `index.html`'s inline script (Task 1).
- Produces: `useThemeStore()` exposing `{ theme: "dark" | "light", toggleTheme: () => void }`; `ThemeToggle` component (no props). Task 3 renders `ThemeToggle` inside `Toolbar`.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/themeStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore } from "../store/themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useThemeStore.setState({ theme: "dark" });
  });

  it("toggleTheme flips dark to light and back", () => {
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("toggleTheme sets the data-theme attribute on <html>", () => {
    useThemeStore.getState().toggleTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("toggleTheme persists the choice to localStorage", () => {
    useThemeStore.getState().toggleTheme();
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
```

`src/__tests__/ThemeToggle.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useThemeStore } from "../store/themeStore";
import ThemeToggle from "../components/ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: "dark" });
  });

  it("toggles the theme when clicked", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(useThemeStore.getState().theme).toBe("light");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run themeStore ThemeToggle`
Expected: FAIL — neither `src/store/themeStore.ts` nor `src/components/ThemeToggle.tsx` exist yet.

- [ ] **Step 3: Write the implementation**

`src/store/themeStore.ts`:

```typescript
import { create } from "zustand";

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
}

function initialTheme(): Theme {
  return localStorage.getItem("theme") === "light" ? "light" : "dark";
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme(),
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },
}));
```

`src/components/ThemeToggle.tsx`:

```typescript
import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "../store/themeStore";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useThemeStore();
  return (
    <button
      className="text-text-muted hover:text-text-primary px-1"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run themeStore ThemeToggle`
Expected: all 4 tests pass.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 3: Restyle App, SearchBar, Toolbar (+ ThemeToggle wiring)

**Files:**
- Modify: `src/components/App.tsx`
- Modify: `src/components/SearchBar.tsx`
- Modify: `src/components/Toolbar.tsx`

**Interfaces:**
- Consumes: Tailwind tokens (Task 1), `ThemeToggle` (Task 2).
- Produces: nothing new for later tasks — this is a leaf restyle.

No new test — verified by re-running the existing `Toolbar.test.tsx` (the only test file touching these three components) to confirm no regression, since icons are added without changing any tested button name.

- [ ] **Step 1: Restyle App.tsx**

```typescript
import Sidebar from "./components/Sidebar";
import CommitGraph from "./components/CommitGraph";
import SearchBar from "./components/SearchBar";
import Toolbar from "./components/Toolbar";
import CommitDrawer from "./components/CommitDrawer";

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-canvas text-text-primary">
      <SearchBar />
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <CommitGraph />
          <CommitDrawer />
        </div>
      </div>
    </div>
  );
}
```

(this file is at `src/App.tsx`, not `src/components/App.tsx` — the import paths above are relative to `src/App.tsx` and are unchanged from the current file)

- [ ] **Step 2: Restyle SearchBar.tsx**

```typescript
import { Search } from "lucide-react";
import { useSearchStore } from "../store/searchStore";

export default function SearchBar() {
  const { query, setQuery } = useSearchStore();
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface border-b border-border-subtle">
      <Search size={14} className="text-text-muted shrink-0" />
      <input
        className="flex-1 bg-elevated border border-border-subtle rounded px-2 py-1 text-sm text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Search branches, tags, commits..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Restyle Toolbar.tsx**

```typescript
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
      <button
        className="flex items-center gap-1 text-xs px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary disabled:opacity-50"
        onClick={() => run(invokePushRemote, false)}
        disabled={!activeRepo}
      >
        <ArrowUpFromLine size={12} /> Push
      </button>
      {error && <span className="text-xs text-danger truncate">{error}</span>}
      <div className="flex-1" />
      <ThemeToggle />
    </div>
  );
}
```

- [ ] **Step 4: Verify no regression**

Run: `npx vitest run Toolbar`
Expected: both existing tests still pass — `getByRole("button", { name: "Push" })` etc. still resolve correctly since the icons contribute no text to the accessible name.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 4: Restyle Sidebar, RepoList, BranchTree

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/RepoList.tsx`
- Modify: `src/components/BranchTree.tsx`

**Interfaces:**
- Consumes: Tailwind tokens (Task 1).
- Produces: nothing new for later tasks.

No new test — verified by re-running `BranchTree.test.tsx` (the only test file touching these three components).

- [ ] **Step 1: Restyle Sidebar.tsx**

```typescript
import RepoList from "./RepoList";
import BranchTree from "./BranchTree";
import AdvancedSearch from "./AdvancedSearch";
import WorkingCopyPanel from "./WorkingCopyPanel";

export default function Sidebar() {
  return (
    <div className="w-64 border-r border-border-subtle bg-surface h-full overflow-y-auto flex flex-col">
      <RepoList />
      <BranchTree />
      <WorkingCopyPanel />
      <AdvancedSearch />
    </div>
  );
}
```

- [ ] **Step 2: Restyle RepoList.tsx (no icon — see plan header note)**

```typescript
import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../store/workspaceStore";

export default function RepoList() {
  const { repos, activeRepoId, loadRepos, addRepo, setActiveRepo } = useWorkspaceStore();

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

  const handleAdd = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      await addRepo(selected);
    }
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      <button
        className="text-sm text-left px-2 py-1 rounded text-text-muted hover:bg-hover hover:text-text-primary"
        onClick={handleAdd}
      >
        + Add repo
      </button>
      {repos.map((r) => (
        <button
          key={r.id}
          className={`text-sm text-left px-2 py-1 rounded ${
            r.id === activeRepoId ? "bg-accent-soft text-accent font-medium" : "text-text-primary hover:bg-hover"
          }`}
          onClick={() => setActiveRepo(r.id)}
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Restyle BranchTree.tsx**

```typescript
import { GitBranch, Tag as TagIcon } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { fuzzyMatch } from "../lib/fuzzyMatch";

export default function BranchTree() {
  const { branches, tags } = useWorkspaceStore();
  const { query } = useSearchStore();
  const local = branches.filter((b) => !b.isRemote && fuzzyMatch(query, b.name));
  const remote = branches.filter((b) => b.isRemote && fuzzyMatch(query, b.name));
  const filteredTags = tags.filter((t) => fuzzyMatch(query, t.name));

  return (
    <div className="text-sm p-2">
      <div className="text-xs uppercase text-text-muted mt-2">Branches</div>
      {local.map((b) => (
        <div
          key={b.name}
          data-head={b.isHead}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${
            b.isHead ? "bg-accent-soft text-accent font-medium" : "text-text-primary"
          }`}
        >
          <GitBranch size={12} />
          <span>{b.name}</span>
        </div>
      ))}
      <div className="text-xs uppercase text-text-muted mt-2">Remotes</div>
      {remote.map((b) => (
        <div key={b.name} data-head={b.isHead} className="flex items-center gap-1.5 px-2 py-0.5 text-text-muted">
          <GitBranch size={12} />
          <span>{b.name}</span>
        </div>
      ))}
      <div className="text-xs uppercase text-text-muted mt-2">Tags</div>
      {filteredTags.map((t) => (
        <div key={t.name} className="flex items-center gap-1.5 px-2 py-0.5 text-text-primary">
          <TagIcon size={12} />
          <span>{t.name}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify no regression**

Run: `npx vitest run BranchTree`
Expected: all 3 existing tests still pass — `getByText("main")`, `.closest("[data-head]")`, and the search-filter test all still resolve since the `<span>{b.name}</span>` structure is unchanged.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 5: Restyle WorkingCopyPanel, AdvancedSearch

**Files:**
- Modify: `src/components/WorkingCopyPanel.tsx`
- Modify: `src/components/AdvancedSearch.tsx`

**Interfaces:**
- Consumes: Tailwind tokens (Task 1).
- Produces: nothing new for later tasks.

No new test — verified by re-running `WorkingCopyPanel.test.tsx` and `AdvancedSearch.test.tsx`.

- [ ] **Step 1: Restyle WorkingCopyPanel.tsx**

```typescript
import { useEffect } from "react";
import { Plus, Minus } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useWorkingCopyStore } from "../store/workingCopyStore";

export default function WorkingCopyPanel() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { status, commitMessage, setCommitMessage, refreshStatus, stage, unstage, commit } =
    useWorkingCopyStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  useEffect(() => {
    if (activeRepo) refreshStatus(activeRepo.path);
  }, [activeRepo?.path, refreshStatus]);

  if (!activeRepo) return null;

  return (
    <div className="p-2 border-t border-border-subtle text-sm">
      <div className="text-xs uppercase text-text-muted mb-1">Changes</div>
      <div className="flex flex-col gap-1 mb-2">
        {status.map((entry) => (
          <div key={entry.path} className="flex items-center justify-between gap-1">
            <span className="truncate flex-1 font-mono text-xs text-text-primary">{entry.path}</span>
            <span className="text-text-muted text-xs">{entry.state}</span>
            {entry.state === "ModifiedStaged" ? (
              <button
                className="flex items-center gap-1 text-xs px-2 py-0.5 bg-elevated border border-border-subtle rounded text-text-primary"
                onClick={() => unstage(activeRepo.path, entry.path)}
              >
                <Minus size={11} /> Unstage
              </button>
            ) : (
              <button
                className="flex items-center gap-1 text-xs px-2 py-0.5 bg-elevated border border-border-subtle rounded text-text-primary"
                onClick={() => stage(activeRepo.path, entry.path)}
              >
                <Plus size={11} /> Stage
              </button>
            )}
          </div>
        ))}
      </div>
      <input
        className="w-full px-2 py-1 bg-elevated border border-border-subtle rounded mb-1 text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Commit message"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
      />
      <button
        className="w-full px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50"
        onClick={() => commit(activeRepo.path)}
        disabled={commitMessage.trim().length === 0}
      >
        Commit
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Restyle AdvancedSearch.tsx**

```typescript
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";

export default function AdvancedSearch() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const {
    historyQuery,
    setHistoryQuery,
    authorFilter,
    setAuthorFilter,
    sinceFilter,
    setSinceFilter,
    untilFilter,
    setUntilFilter,
    advancedResults,
    runAdvancedSearch,
  } = useSearchStore();

  const activeRepo = repos.find((r) => r.id === activeRepoId);

  const handleSearch = () => {
    if (!activeRepo) return;
    runAdvancedSearch(activeRepo.path);
  };

  return (
    <div className="p-2 border-t border-border-subtle text-sm">
      <div className="text-xs uppercase text-text-muted mb-1">Search history</div>
      <input
        className="w-full px-2 py-1 bg-elevated border border-border-subtle rounded mb-1 text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Message or code..."
        value={historyQuery}
        onChange={(e) => setHistoryQuery(e.target.value)}
      />
      <input
        className="w-full px-2 py-1 bg-elevated border border-border-subtle rounded mb-1 text-text-primary outline-none placeholder:text-text-muted"
        placeholder="Author"
        value={authorFilter}
        onChange={(e) => setAuthorFilter(e.target.value)}
      />
      <div className="flex gap-1 mb-1">
        <input
          type="date"
          className="flex-1 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary"
          value={sinceFilter}
          onChange={(e) => setSinceFilter(e.target.value)}
        />
        <input
          type="date"
          className="flex-1 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary"
          value={untilFilter}
          onChange={(e) => setUntilFilter(e.target.value)}
        />
      </div>
      <button
        className="w-full px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50"
        onClick={handleSearch}
        disabled={!activeRepo}
      >
        Search history
      </button>
      <div className="mt-2 flex flex-col gap-1">
        {advancedResults.map((hit) => (
          <div key={hit.oid} data-testid="search-hit" className="px-1 py-0.5 border-b border-border-subtle">
            <div className="font-medium truncate text-text-primary">{hit.summary}</div>
            <div className="text-text-muted text-xs truncate">{hit.snippet}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify no regression**

Run: `npx vitest run WorkingCopyPanel AdvancedSearch`
Expected: all existing tests still pass.

- [ ] **Step 4: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 6: Restyle CommitGraph, CommitGraphRow, CommitDrawer, DiffViewer

**Files:**
- Modify: `src/components/CommitGraph.tsx`
- Modify: `src/components/CommitGraphRow.tsx`
- Modify: `src/components/CommitDrawer.tsx`
- Modify: `src/components/DiffViewer.tsx`

**Interfaces:**
- Consumes: Tailwind tokens (Task 1).
- Produces: nothing new for later tasks — last restyle task in this plan.

No new test — verified by re-running `CommitGraph.test.tsx` and `CommitDrawer.test.tsx`, the two test files touching these four components.

- [ ] **Step 1: Restyle CommitGraph.tsx**

```typescript
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { fuzzyMatch } from "../lib/fuzzyMatch";
import CommitGraphRow from "./CommitGraphRow";

export default function CommitGraph() {
  const { commits } = useWorkspaceStore();
  const { query } = useSearchStore();
  const visible = commits.filter((c) => fuzzyMatch(query, c.summary));

  return (
    <div className="flex-1 overflow-y-auto bg-canvas">
      {visible.map((c) => (
        <CommitGraphRow key={c.oid} commit={c} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Restyle CommitGraphRow.tsx**

CSS variables are used directly in the SVG `fill` attributes (rather than Tailwind's `fill-*` utilities) so the dot color automatically follows the active theme without any JS changes:

```typescript
import { GraphCommit } from "../lib/tauri";
import { useUiStore } from "../store/uiStore";

const LANE_WIDTH = 16;
const ROW_HEIGHT = 24;

export default function CommitGraphRow({ commit }: { commit: GraphCommit }) {
  const selectCommit = useUiStore((s) => s.selectCommit);
  const cx = 12 + commit.lane * LANE_WIDTH;
  const date = new Date(commit.timestamp * 1000).toLocaleDateString();

  return (
    <div
      data-testid="commit-row"
      className="flex items-center h-6 text-sm cursor-pointer hover:bg-hover text-text-primary"
      style={{ height: ROW_HEIGHT }}
      onClick={() => selectCommit(commit.oid)}
    >
      <svg width={cx + 12} height={ROW_HEIGHT} className="shrink-0">
        <circle cx={cx} cy={ROW_HEIGHT / 2} r={7} fill="var(--accent-soft-bg)" />
        <circle data-testid="commit-dot" cx={cx} cy={ROW_HEIGHT / 2} r={4} fill="var(--accent)" />
      </svg>
      <span className="truncate flex-1">{commit.summary}</span>
      <span className="text-text-muted w-24 text-right font-mono text-xs">{commit.author}</span>
      <span className="text-text-muted w-20 text-right font-mono text-xs">{date}</span>
    </div>
  );
}
```

- [ ] **Step 3: Restyle CommitDrawer.tsx**

The "Close" text is replaced by an `X` icon — no test asserts on the "Close" text (verified in `CommitDrawer.test.tsx`), and `aria-label="Close"` preserves the accessible name.

```typescript
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useUiStore } from "../store/uiStore";
import { invokeGetCommitDiff, type CommitDetail } from "../lib/tauri";
import DiffViewer from "./DiffViewer";

export default function CommitDrawer() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { selectedCommitOid, selectCommit } = useUiStore();
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);

  useEffect(() => {
    if (!activeRepo || !selectedCommitOid) {
      setDetail(null);
      return;
    }
    invokeGetCommitDiff(activeRepo.path, selectedCommitOid).then(setDetail);
  }, [activeRepo?.path, selectedCommitOid]);

  if (!selectedCommitOid || !detail) return null;

  const date = new Date(detail.timestamp * 1000).toLocaleString();

  return (
    <div className="border-t border-border-subtle bg-surface max-h-80 overflow-y-auto p-3">
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-medium text-text-primary">{detail.message}</div>
          <div className="text-xs text-text-muted font-mono">
            {detail.author} &lt;{detail.email}&gt; — {date}
          </div>
        </div>
        <button
          className="text-text-muted hover:text-text-primary"
          onClick={() => selectCommit(null)}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
      <DiffViewer files={detail.files} />
    </div>
  );
}
```

- [ ] **Step 4: Restyle DiffViewer.tsx**

```typescript
import { useState } from "react";
import { type FileDiff } from "../lib/tauri";

export default function DiffViewer({ files }: { files: FileDiff[] }) {
  const [mode, setMode] = useState<"unified" | "split">("unified");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 bg-elevated p-0.5 rounded w-fit">
        <button
          className={`text-xs px-2 py-0.5 rounded ${mode === "unified" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
          onClick={() => setMode("unified")}
        >
          Unified
        </button>
        <button
          className={`text-xs px-2 py-0.5 rounded ${mode === "split" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
          onClick={() => setMode("split")}
        >
          Side-by-side
        </button>
      </div>
      {files.map((file) => (
        <div key={file.path} className="border border-border-subtle rounded overflow-hidden">
          <div className="px-2 py-1 bg-elevated text-xs font-mono flex justify-between">
            <span className="text-text-primary">{file.path}</span>
            <span className="text-text-muted">
              {file.status} <span className="text-success">+{file.insertions}</span>{" "}
              <span className="text-danger">-{file.deletions}</span>
            </span>
          </div>
          {mode === "unified" ? (
            <pre className="text-xs p-2 overflow-x-auto whitespace-pre-wrap font-mono text-text-primary bg-canvas">
              {file.patch}
            </pre>
          ) : (
            <div className="grid grid-cols-2 gap-px bg-border-subtle">
              <pre className="text-xs p-2 bg-canvas overflow-x-auto whitespace-pre-wrap font-mono text-text-primary">
                {file.oldContent ?? ""}
              </pre>
              <pre className="text-xs p-2 bg-canvas overflow-x-auto whitespace-pre-wrap font-mono text-text-primary">
                {file.newContent ?? ""}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Verify no regression**

Run: `npx vitest run CommitGraph CommitDrawer`
Expected: all existing tests still pass — `getAllByTestId("commit-dot")` still finds the (now second, still uniquely-testid'd) inner circle at the same `cx` values.

- [ ] **Step 6: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 7: Full regression and visual verification

**Files:** none — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all Vitest suites pass, including the two new `themeStore`/`ThemeToggle` suites and every existing suite from Plans 1–3.

Run: `npm run e2e`
Expected: all three existing Playwright specs (`workspace.spec.ts`, `search.spec.ts`, `workingcopy.spec.ts`) still pass — they select elements by role/placeholder/testid, none of which changed.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: unaffected — this plan touches no Rust code. All tests from Plans 1–3 still pass.

Run: `npm run build`
Expected: succeeds, and (re-confirming Task 1's check) `dist/assets/*.css` contains the compiled token-based utility classes.

- [ ] **Step 2: Mark task complete**

No commit (see Global Constraints). Update the progress ledger — the visual design pass is now complete.

---

## Definition of Done

- Tailwind is genuinely compiling (verified via the `dist/assets/*.css` grep in Tasks 1 and 7) — no longer a dead devDependency.
- The app renders in the dark, amber-accented developer-tool theme by default, with a working, persisted light theme toggle in the toolbar.
- Every restyled component keeps its existing tested button names, placeholders, and `data-testid`s — zero test file needed to change its assertions, only two new test files were added (`themeStore`, `ThemeToggle`).
- `npm test`, `npm run e2e`, and `cargo test` all pass with no regressions from Plans 1–3.
