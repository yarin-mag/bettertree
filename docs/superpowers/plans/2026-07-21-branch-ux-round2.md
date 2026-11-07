# Branch UX Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a loading indicator and a "command palette" visual redesign (with persisted recent branches) to the Base/Head branch combobox; make sidebar tags checkable out (detached HEAD) with a small backend addition; surface a detached-HEAD indicator in the sidebar; and make the sidebar's Remotes section collapsible, collapsed by default.

**Architecture:** Two backend (Rust/git2) changes — reshaping `list_branches`'s return value to also report detached-HEAD state, and a new `checkout_tag` command mirroring the existing `switch_branch` — feed two small frontend store additions (`workspaceStore`), which `BranchTree.tsx` then surfaces as UI. Separately, `BranchCombobox` (frontend-only, from the prior round) gets a loading prop, a visual redesign, and a small new `recentBranches.ts` localStorage helper. The two halves (BranchTree vs BranchCombobox) don't depend on each other and are ordered backend-first so frontend tasks that consume the new store fields have something real to wire against.

**Tech Stack:** Rust + git2 (`src-tauri`), React 18 + TypeScript + Zustand (frontend), Tailwind CSS, Vitest + @testing-library/react, Rust's built-in `#[test]` + existing `test_support.rs` fixtures. No new dependencies (frontend or Cargo).

## Global Constraints

- This project is intentionally not tracked in git (explicit prior decision — no `git init`/`git add`/`git commit`; each task ends by running tests, not committing).
- Follow existing patterns exactly: Rust commands go through `run_blocking` in `commands.rs`; TS tests live under `src/__tests__/`; lucide-react icons are named imports; Tailwind classes match the app's existing token names (`bg-elevated`, `border-border-subtle`, `bg-accent-soft`, `text-text-muted`, etc. — see `src/index.css`).
- `AppError` (`src-tauri/src/error.rs`) already has `#[from] git2::Error`, so any `?` on a `git2::Error`-returning call inside a `Result<_, AppError>` function auto-converts — no manual `.map_err` needed anywhere in this plan.
- `git2 = "0.19"` is already a dependency; no Cargo.toml change needed for any task here.
- The "Recent" section in the redesigned combobox is a shortcut shown above the full list, not a replacement for it — the full list must always stay visible, regardless of filter text.

---

### Task 1: Backend — report detached-HEAD state from `list_branches`

**Files:**
- Modify: `src-tauri/src/repo.rs`
- Modify: `src-tauri/src/commands.rs:8,60-63`

**Interfaces:**
- Consumes: nothing new (uses the existing `repo.head()` call already present in `list_branches`).
- Produces: `pub struct BranchListResult { pub branches: Vec<BranchInfo>, pub head_detached: bool, pub head_oid: Option<String> }` (serialized `camelCase`) from `repo::list_branches`, consumed by `commands::get_branches` (Task 1) and, on the frontend, by Task 3.

- [ ] **Step 1: Write the failing/changed Rust tests**

In `src-tauri/src/repo.rs`, update the existing test `lists_local_and_remote_branches_with_head_flag` (it currently does `list_branches(...).unwrap()` and iterates the result directly as a `Vec`) to match the new return shape, and add a new test for the detached case:

```rust
    #[test]
    fn lists_local_and_remote_branches_with_head_flag() {
        let (dir, _repo) = init_repo_with_commits();
        let result = list_branches(dir.path().to_str().unwrap()).unwrap();
        let names: Vec<&str> = result.branches.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"main"));
        assert!(names.contains(&"feature"));

        let head_branch = result.branches.iter().find(|b| b.is_head).unwrap();
        assert_eq!(head_branch.name, "main");
        assert!(!head_branch.is_remote);
        assert!(!result.head_detached);
    }

    #[test]
    fn reports_detached_head_with_no_branch_marked_as_head() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head_oid = repo.head().unwrap().target().unwrap();
        repo.set_head_detached(head_oid).unwrap();

        let result = list_branches(repo_path).unwrap();

        assert!(result.head_detached);
        assert_eq!(result.head_oid, Some(head_oid.to_string()));
        assert!(result.branches.iter().all(|b| !b.is_head));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib repo::tests`
Expected: FAIL to compile — `list_branches` still returns `Vec<BranchInfo>`, so `.branches` doesn't exist on it, and `reports_detached_head_with_no_branch_marked_as_head` is a new test referencing fields that don't exist yet.

- [ ] **Step 3: Change `list_branches`'s return type**

In `src-tauri/src/repo.rs`, add the new struct right after `BranchInfo` and change `list_branches`:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchListResult {
    pub branches: Vec<BranchInfo>,
    pub head_detached: bool,
    pub head_oid: Option<String>,
}

pub fn list_branches(repo_path: &str) -> Result<BranchListResult, AppError> {
    let repo = Repository::open(repo_path)?;
    let head_ref = repo.head().ok();
    let head_name = head_ref
        .as_ref()
        .and_then(|h| h.shorthand())
        .map(|s| s.to_string());
    let head_detached = repo.head_detached().unwrap_or(false);
    let head_oid = head_ref.as_ref().and_then(|h| h.target()).map(|o| o.to_string());

    let mut branches = Vec::new();
    for branch_result in repo.branches(None)? {
        let (branch, branch_type) = branch_result?;
        let name = branch.name()?.unwrap_or("").to_string();
        let is_remote = branch_type == BranchType::Remote;
        let target_oid = branch
            .get()
            .target()
            .map(|o| o.to_string())
            .unwrap_or_default();
        let is_head = !is_remote && head_name.as_deref() == Some(name.as_str());
        branches.push(BranchInfo {
            name,
            is_remote,
            is_head,
            target_oid,
        });
    }
    Ok(BranchListResult {
        branches,
        head_detached,
        head_oid,
    })
}
```

(Only the return type, the local `out` → `branches` rename, and the final `Ok(...)` construction changed — the per-branch loop body is otherwise identical to before.)

- [ ] **Step 4: Update the Tauri command wrapper**

In `src-tauri/src/commands.rs`, change line 8's import and lines 60-63:

```rust
use crate::repo::{self, BranchInfo, BranchListResult, TagInfo};
```

```rust
#[tauri::command]
pub async fn get_branches(repo_path: String) -> Result<BranchListResult, AppError> {
    run_blocking(move || repo::list_branches(&repo_path)).await
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib repo::tests`
Expected: PASS — both tests green.

- [ ] **Step 6: Update the frontend type and store to match the new shape**

In `src/lib/tauri.ts`, change `invokeGetBranches` and add the matching TS type (place near the existing `BranchInfo` interface):

```ts
export interface BranchListResult {
  branches: BranchInfo[];
  headDetached: boolean;
  headOid: string | null;
}

export const invokeGetBranches = (repoPath: string) =>
  invoke<BranchListResult>("get_branches", { repoPath });
```

In `src/store/workspaceStore.ts`, add `headDetached`/`headOid` to the state interface and initial state, and update `refreshActiveRepoData` to destructure the new shape:

```ts
interface WorkspaceState {
  repos: RepoEntry[];
  activeRepoId: number | null;
  branches: BranchInfo[];
  headDetached: boolean;
  headOid: string | null;
  tags: TagInfo[];
  commits: GraphCommit[];
  loadRepos: () => Promise<void>;
  addRepo: (path: string) => Promise<void>;
  setActiveRepo: (id: number) => Promise<void>;
  switchBranch: (repoPath: string, branchName: string, isRemote: boolean) => Promise<void>;
  refreshActiveRepoData: (repoPath: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  repos: [],
  activeRepoId: null,
  branches: [],
  headDetached: false,
  headOid: null,
  tags: [],
  commits: [],

  loadRepos: async () => {
    const repos = await invokeListRepos();
    set({ repos });
  },

  addRepo: async (path: string) => {
    const repo = await invokeAddRepo(path);
    set({ repos: [...get().repos, repo] });
  },

  refreshActiveRepoData: async (repoPath: string) => {
    const [branchResult, tags, commits] = await Promise.all([
      invokeGetBranches(repoPath),
      invokeGetTags(repoPath),
      invokeGetCommitGraph(repoPath, 200),
    ]);
    set({
      branches: branchResult.branches,
      headDetached: branchResult.headDetached,
      headOid: branchResult.headOid,
      tags,
      commits,
    });
    // Fire-and-forget: index build must not block the UI, and a failed
    // build degrades to the live-walk fallback in search_commits.
    invokeEnsureSearchIndex(repoPath).catch(() => {});
    invokeGetGithubStatus(repoPath).then((status) => {
      useGithubStore.setState({ status });
    });
  },

  setActiveRepo: async (id: number) => {
    const repo = get().repos.find((r) => r.id === id);
    if (!repo) return;
    set({ activeRepoId: id });
    await get().refreshActiveRepoData(repo.path);
  },

  switchBranch: async (repoPath: string, branchName: string, isRemote: boolean) => {
    await invokeSwitchBranch(repoPath, branchName, isRemote);
    await get().refreshActiveRepoData(repoPath);
  },
}));
```

- [ ] **Step 7: Update `workspaceStore.test.ts`'s mocks to the new `invokeGetBranches` shape**

In `src/__tests__/workspaceStore.test.ts`, every `(tauriLib.invokeGetBranches as any).mockResolvedValue([...])` call must wrap its array in the new object shape. Replace all four occurrences:

```ts
    (tauriLib.invokeGetBranches as any).mockResolvedValue({
      branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "abc" }],
      headDetached: false,
      headOid: null,
    });
```
(in `"setActiveRepo loads branches, tags, and commits for that repo"`)

```ts
    (tauriLib.invokeGetBranches as any).mockResolvedValue({ branches: [], headDetached: false, headOid: null });
```
(in both `"setActiveRepo fires ensure_search_index without blocking on it"` and `"setActiveRepo fires get_github_status without blocking on it"`)

```ts
    (tauriLib.invokeGetBranches as any).mockResolvedValue({
      branches: [{ name: "feature", isRemote: false, isHead: true, targetOid: "abc" }],
      headDetached: false,
      headOid: null,
    });
```
(in `"switchBranch calls invokeSwitchBranch then refreshes branches/tags/commits"`)

Also add the two new fields to the `beforeEach` reset for completeness:

```ts
  beforeEach(() => {
    useWorkspaceStore.setState({
      repos: [],
      activeRepoId: null,
      branches: [],
      headDetached: false,
      headOid: null,
      tags: [],
      commits: [],
    });
  });
```

- [ ] **Step 8: Run the frontend tests to verify they pass**

Run: `npm test -- workspaceStore`
Expected: PASS — all tests green.

---

### Task 2: Backend — `checkout_tag` command (detached HEAD)

**Files:**
- Modify: `src-tauri/src/branch.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `workdir::get_status` (existing, same dirty-check used by `switch_branch`), `git2::Repository`/`CheckoutBuilder` (existing imports in `branch.rs`).
- Produces: `pub fn checkout_tag(repo_path: &str, tag_name: &str) -> Result<(), AppError>`, wrapped by the Tauri command `checkout_tag`, consumed by Task 4's frontend wiring.

- [ ] **Step 1: Write the failing Rust tests**

In `src-tauri/src/branch.rs`'s `mod tests`, add:

```rust
    #[test]
    fn checks_out_a_lightweight_tag_detached() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head_oid = repo.head().unwrap().target().unwrap();
        let commit_obj = repo.find_object(head_oid, None).unwrap();
        repo.tag_lightweight("v1.0", &commit_obj, false).unwrap();

        checkout_tag(repo_path, "v1.0").unwrap();

        assert!(repo.head_detached().unwrap());
        assert_eq!(repo.head().unwrap().target().unwrap(), head_oid);
    }

    #[test]
    fn checks_out_an_annotated_tag_detached() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head_oid = repo.head().unwrap().target().unwrap();
        let commit_obj = repo.find_object(head_oid, None).unwrap();
        let sig = repo.signature().unwrap();
        repo.tag("v2.0", &commit_obj, &sig, "release v2.0", false).unwrap();

        checkout_tag(repo_path, "v2.0").unwrap();

        assert!(repo.head_detached().unwrap());
        assert_eq!(repo.head().unwrap().target().unwrap(), head_oid);
    }

    #[test]
    fn blocks_tag_checkout_when_working_tree_is_dirty() {
        let (dir, repo) = init_repo_with_commits();
        let repo_path = dir.path().to_str().unwrap();
        let head_oid = repo.head().unwrap().target().unwrap();
        let commit_obj = repo.find_object(head_oid, None).unwrap();
        repo.tag_lightweight("v1.0", &commit_obj, false).unwrap();
        std::fs::write(dir.path().join("a.txt"), "modified but not staged").unwrap();

        let result = checkout_tag(repo_path, "v1.0");

        assert!(result.is_err());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib branch::tests`
Expected: FAIL to compile — `checkout_tag` doesn't exist yet.

- [ ] **Step 3: Implement `checkout_tag`**

In `src-tauri/src/branch.rs`, add this function after `switch_branch` (same file, so it reuses the existing `use crate::workdir;`, `use git2::build::CheckoutBuilder;`, `use git2::Repository;` imports at the top — no new imports needed except `git2::ObjectType`, added inline below):

```rust
pub fn checkout_tag(repo_path: &str, tag_name: &str) -> Result<(), AppError> {
    let status = workdir::get_status(repo_path)?;
    if !status.is_empty() {
        return Err(AppError::Operation(
            "cannot checkout a tag with uncommitted changes".into(),
        ));
    }

    let repo = Repository::open(repo_path)?;
    let obj = repo.revparse_single(&format!("refs/tags/{tag_name}"))?;
    let commit = obj.peel(git2::ObjectType::Commit)?;
    repo.checkout_tree(&commit, Some(&mut CheckoutBuilder::new()))?;
    repo.set_head_detached(commit.id())?;
    Ok(())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib branch::tests`
Expected: PASS — all tests green, including the three new ones.

- [ ] **Step 5: Register the Tauri command**

In `src-tauri/src/commands.rs`, add next to `switch_branch` (near line 190-197):

```rust
#[tauri::command]
pub async fn checkout_tag(repo_path: String, tag_name: String) -> Result<(), AppError> {
    run_blocking(move || branch::checkout_tag(&repo_path, &tag_name)).await
}
```

In `src-tauri/src/lib.rs`, add `commands::checkout_tag,` to the `tauri::generate_handler![...]` list, right after `commands::switch_branch,`.

- [ ] **Step 6: Run the full Rust test suite to verify nothing else broke**

Run: `cd src-tauri && cargo test`
Expected: PASS — all suites green.

- [ ] **Step 7: Add the frontend invoke wrapper**

In `src/lib/tauri.ts`, add next to `invokeSwitchBranch`:

```ts
export const invokeCheckoutTag = (repoPath: string, tagName: string) =>
  invoke<void>("checkout_tag", { repoPath, tagName });
```

- [ ] **Step 8: Add the `workspaceStore` action**

In `src/store/workspaceStore.ts`, import `invokeCheckoutTag` alongside the other `invoke*` imports, add `checkoutTag: (repoPath: string, tagName: string) => Promise<void>;` to `WorkspaceState`, and add the implementation next to `switchBranch`:

```ts
  checkoutTag: async (repoPath: string, tagName: string) => {
    await invokeCheckoutTag(repoPath, tagName);
    await get().refreshActiveRepoData(repoPath);
  },
```

- [ ] **Step 9: Write and run a store-level test**

In `src/__tests__/workspaceStore.test.ts`, add `invokeCheckoutTag: vi.fn(),` to the `vi.mock("../lib/tauri", ...)` block, then add:

```ts
  it("checkoutTag calls invokeCheckoutTag then refreshes branches/tags/commits", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeCheckoutTag as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetBranches as any).mockResolvedValue({
      branches: [],
      headDetached: true,
      headOid: "abc123",
    });
    (tauriLib.invokeGetTags as any).mockResolvedValue([{ name: "v1.0", targetOid: "abc123" }]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().checkoutTag("/tmp/a", "v1.0");

    expect(tauriLib.invokeCheckoutTag).toHaveBeenCalledWith("/tmp/a", "v1.0");
    expect(useWorkspaceStore.getState().headDetached).toBe(true);
    expect(useWorkspaceStore.getState().headOid).toBe("abc123");
  });
```

Run: `npm test -- workspaceStore`
Expected: PASS — all tests green, including the new one.

---

### Task 3: `BranchCombobox` — loading indicator

**Files:**
- Modify: `src/store/githubStore.ts`
- Modify: `src/components/BranchCombobox.tsx`
- Modify: `src/__tests__/BranchCombobox.test.tsx`
- Modify: `src/components/PullRequestsScreen.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useGithubStore().isLoadingBranches: boolean`; `BranchCombobox`'s new `isLoading?: boolean` prop (default falsy — Task 5/6 don't need to touch this prop, they only add to the popover markup).

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/BranchCombobox.test.tsx`, add:

```tsx
  it("shows a spinner and disables the trigger while loading", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={[]} isLoading />);
    const trigger = screen.getByRole("button");
    expect(trigger).toBeDisabled();
    expect(trigger.querySelector(".animate-spin")).not.toBeNull();
  });

  it("does not show a spinner or disable the trigger once loaded", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} isLoading={false} />);
    const trigger = screen.getByRole("button");
    expect(trigger).not.toBeDisabled();
    expect(trigger.querySelector(".animate-spin")).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- BranchCombobox`
Expected: FAIL — `isLoading` prop doesn't exist yet, trigger is never disabled, no spinner is ever rendered.

- [ ] **Step 3: Add the loading state to `githubStore`**

In `src/store/githubStore.ts`, add `isLoadingBranches: boolean` next to `branches`, and set it around the existing `loadBranches`:

```ts
  branches: string[];
  isLoadingBranches: boolean;
  loadBranches: (repoPath: string) => Promise<void>;
```

```ts
  branches: [],
  isLoadingBranches: false,
  loadBranches: async (repoPath: string) => {
    set({ isLoadingBranches: true });
    try {
      const branches = await invokeListGithubBranches(repoPath);
      set({ branches });
    } finally {
      set({ isLoadingBranches: false });
    }
  },
```

- [ ] **Step 4: Add the `isLoading` prop to `BranchCombobox`**

In `src/components/BranchCombobox.tsx`, add `isLoading?: boolean` to `BranchComboboxProps`, and update the trigger button:

```tsx
interface BranchComboboxProps {
  value: string | undefined;
  onChange: (value: string | null) => void;
  branches: string[];
  isLoading?: boolean;
}

export default function BranchCombobox({ value, onChange, branches, isLoading }: BranchComboboxProps) {
```

```tsx
      <button
        type="button"
        disabled={isLoading}
        className="w-32 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary text-left truncate flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
        onClick={() => setIsOpen((o) => !o)}
      >
        {isLoading ? (
          <Loader2 size={12} className="animate-spin shrink-0" />
        ) : null}
        <span className="truncate">{value ?? "Any"}</span>
      </button>
```

Add the import at the top: `import { Loader2 } from "lucide-react";` (this icon is already used elsewhere in the app, e.g. `PullRequestsScreen.tsx`).

- [ ] **Step 5: Wire `isLoading` through `PullRequestsScreen`**

In `src/components/PullRequestsScreen.tsx`, destructure `isLoadingBranches` from `useGithubStore()` and pass it to both comboboxes:

```tsx
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
```

```tsx
          <BranchCombobox
            value={getQualifier(query, "base")}
            onChange={(v) => setQualifier("base", v)}
            branches={branches}
            isLoading={isLoadingBranches}
          />
```

```tsx
          <BranchCombobox
            value={getQualifier(query, "head")}
            onChange={(v) => setQualifier("head", v)}
            branches={branches}
            isLoading={isLoadingBranches}
          />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- BranchCombobox PullRequestsScreen githubStore`
Expected: PASS — all tests green.

---

### Task 4: `BranchCombobox` — command-palette redesign (style C)

**Files:**
- Modify: `src/components/BranchCombobox.tsx`
- Modify: `src/__tests__/BranchCombobox.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports — same `{ value, onChange, branches, isLoading }` props from Task 3; only the popover's internal markup/styling and the filter placeholder text change. Task 5 (recent branches) builds on top of this task's row-rendering structure.

- [ ] **Step 1: Update the tests that reference now-changed copy/structure**

In `src/__tests__/BranchCombobox.test.tsx`, the placeholder text changes from `"Filter branches..."` to `"Jump to branch..."`. Update every occurrence of `getByPlaceholderText("Filter branches...")` / `queryByPlaceholderText("Filter branches...")` in the file to `"Jump to branch..."`. Add one new test for the footer and one for the "current" tag:

```tsx
  it("shows keyboard hints in the footer", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/navigate/)).toBeInTheDocument();
    expect(screen.getByText(/select/)).toBeInTheDocument();
    expect(screen.getByText(/close/)).toBeInTheDocument();
  });

  it("tags the row matching the current value as current", () => {
    render(<BranchCombobox value="develop" onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button", { name: "develop" }));
    const row = screen.getByText("develop", { selector: ".row-name" }).closest("[data-branch-row]");
    expect(row).toHaveTextContent("current");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- BranchCombobox`
Expected: FAIL — placeholder text mismatch, no footer text, no `.row-name`/`data-branch-row` markup yet.

- [ ] **Step 3: Redesign the popover**

Replace the full contents of `src/components/BranchCombobox.tsx` with:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { fuzzyMatch } from "../lib/fuzzyMatch";

interface BranchComboboxProps {
  value: string | undefined;
  onChange: (value: string | null) => void;
  branches: string[];
  isLoading?: boolean;
}

export default function BranchCombobox({ value, onChange, branches, isLoading }: BranchComboboxProps) {
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
        disabled={isLoading}
        aria-label={value ?? "Any"}
        className="w-32 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary text-left truncate flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
        onClick={() => setIsOpen((o) => !o)}
      >
        {isLoading ? <Loader2 size={12} className="animate-spin shrink-0" /> : null}
        <span className="truncate">{value ?? "Any"}</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-64 bg-elevated border border-border-subtle rounded-lg shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
            <Search size={13} className="text-accent shrink-0" />
            <input
              ref={inputRef}
              className="w-full bg-transparent outline-none text-text-primary text-sm"
              placeholder="Jump to branch..."
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {rows.map((row, i) => (
              <div
                key={row ?? "__any__"}
                data-branch-row
                onClick={() => selectRow(row)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm ${
                  i === highlightedIndex ? "bg-accent-soft" : ""
                } ${row === null ? "text-text-muted" : "text-text-primary"}`}
              >
                <span className="row-name truncate flex-1">{row ?? "Any"}</span>
                {row !== null && row === value && (
                  <span className="text-[10px] uppercase tracking-wide text-text-muted bg-hover border border-border-subtle rounded px-1 py-0.5 shrink-0">
                    current
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border-subtle text-[10px] text-text-muted">
            <span>↑ ↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

Notes on the diff from Task 3's version: popover width `w-48` → `w-64`; `rounded` → `rounded-lg`; search icon added (accent-colored) in front of the filter input; placeholder text changed; row highlight `bg-hover` → `bg-accent-soft`; rows now carry `data-branch-row` and a `.row-name` span (both needed for the test in Step 1 and reused by Task 5); a "current" tag renders next to the row matching `value`; a keyboard-hint footer was added. The `aria-label={value ?? "Any"}` on the trigger is new too — it makes `getByRole("button", { name: "develop" })` work in the Step 1 test (previously tests used the un-named `getByRole("button")`, which still works since it's the only button).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- BranchCombobox`
Expected: PASS — all tests green (including the pre-existing ones from the prior round, now using the updated placeholder text).

---

### Task 5: `BranchCombobox` — persisted recent branches

**Files:**
- Create: `src/lib/recentBranches.ts`
- Test: `src/__tests__/recentBranches.test.ts`
- Modify: `src/components/BranchCombobox.tsx`
- Modify: `src/__tests__/BranchCombobox.test.tsx`

**Interfaces:**
- Consumes: `window.localStorage` (jsdom provides this in tests, same as any browser).
- Produces: `getRecentBranches(): string[]`, `recordRecentBranch(name: string): void`, both exported from `src/lib/recentBranches.ts`, consumed by `BranchCombobox`.

- [ ] **Step 1: Write the failing tests for the helper**

Create `src/__tests__/recentBranches.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { getRecentBranches, recordRecentBranch } from "../lib/recentBranches";

describe("recentBranches", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when nothing has been recorded", () => {
    expect(getRecentBranches()).toEqual([]);
  });

  it("records a branch and returns it most-recent-first", () => {
    recordRecentBranch("main");
    recordRecentBranch("develop");
    expect(getRecentBranches()).toEqual(["develop", "main"]);
  });

  it("moves a re-picked branch back to the front instead of duplicating it", () => {
    recordRecentBranch("main");
    recordRecentBranch("develop");
    recordRecentBranch("main");
    expect(getRecentBranches()).toEqual(["main", "develop"]);
  });

  it("caps the list at 5 entries", () => {
    ["a", "b", "c", "d", "e", "f"].forEach(recordRecentBranch);
    expect(getRecentBranches()).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("returns an empty list when localStorage holds corrupt data", () => {
    localStorage.setItem("bettertree.recentBranches", "{not json");
    expect(getRecentBranches()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- recentBranches`
Expected: FAIL — `Cannot find module '../lib/recentBranches'`.

- [ ] **Step 3: Write the helper**

Create `src/lib/recentBranches.ts`:

```ts
const STORAGE_KEY = "bettertree.recentBranches";
const MAX_ENTRIES = 5;

export function getRecentBranches(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentBranch(name: string): void {
  const existing = getRecentBranches().filter((n) => n !== name);
  const updated = [name, ...existing].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- recentBranches`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Write the failing `BranchCombobox` integration tests**

In `src/__tests__/BranchCombobox.test.tsx`, add `beforeEach(() => localStorage.clear());` inside the `describe` block (alongside/replacing any existing setup), and add:

```tsx
  it("shows a Recent section above the full list when recents exist", () => {
    recordRecentBranch("feature/foo");
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("omits the Recent section when there are no recents", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("records a branch as recent when it's selected", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("develop"));
    expect(getRecentBranches()).toEqual(["develop"]);
  });

  it("keeps the full list visible even when a Recent section is shown", () => {
    recordRecentBranch("feature/foo");
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByText("feature/foo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("develop")).toBeInTheDocument();
  });
```

Add the import at the top of the test file: `import { getRecentBranches, recordRecentBranch } from "../lib/recentBranches";`.

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npm test -- BranchCombobox`
Expected: FAIL — no "Recent" text is ever rendered yet, and `selectRow` doesn't call `recordRecentBranch`.

- [ ] **Step 7: Wire recents into the component**

In `src/components/BranchCombobox.tsx`, import the helper and use it:

```tsx
import { getRecentBranches, recordRecentBranch } from "../lib/recentBranches";
```

Inside the component, compute the recent list whenever the popover opens, and record on selection:

```tsx
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setFilterText("");
      setHighlightedIndex(0);
      setRecents(getRecentBranches().filter((name) => branches.includes(name)));
      inputRef.current?.focus();
    }
  }, [isOpen, branches]);

  const selectRow = (row: string | null) => {
    if (row !== null) recordRecentBranch(row);
    onChange(row);
    setIsOpen(false);
  };
```

Render the Recent section above the existing rows list, inside the popover, right after the search input div and before the `<div className="max-h-52 overflow-y-auto p-1">` rows block:

```tsx
          {recents.length > 0 && (
            <div className="px-1 pt-1">
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-text-muted">Recent</div>
              {recents.map((name) => (
                <div
                  key={`recent-${name}`}
                  data-branch-row
                  onClick={() => selectRow(name)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm text-text-primary hover:bg-accent-soft"
                >
                  <span className="row-name truncate flex-1">{name}</span>
                  {name === value && (
                    <span className="text-[10px] uppercase tracking-wide text-text-muted bg-hover border border-border-subtle rounded px-1 py-0.5 shrink-0">
                      current
                    </span>
                  )}
                </div>
              ))}
              <div className="border-t border-border-subtle mt-1" />
            </div>
          )}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- BranchCombobox recentBranches`
Expected: PASS — all tests green.

---

### Task 6: `BranchTree` — detached-HEAD indicator

**Files:**
- Modify: `src/components/BranchTree.tsx`
- Modify: `src/__tests__/BranchTree.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaceStore().headDetached: boolean`, `headOid: string | null` (from Task 1).
- Produces: no new exports — a badge rendered conditionally in `BranchTree`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/BranchTree.test.tsx`, add `headDetached: false, headOid: null` to the `beforeEach`'s `useWorkspaceStore.setState({...})` call, then add:

```tsx
  it("shows a detached-HEAD badge naming the matching tag", () => {
    useWorkspaceStore.setState({ headDetached: true, headOid: "a" });
    render(<BranchTree />);
    expect(screen.getByText("Detached @ v1.0")).toBeInTheDocument();
  });

  it("shows a detached-HEAD badge with a short oid when no tag matches", () => {
    useWorkspaceStore.setState({ headDetached: true, headOid: "0123456789abcdef" });
    render(<BranchTree />);
    expect(screen.getByText("Detached @ 0123456")).toBeInTheDocument();
  });

  it("shows no detached-HEAD badge when HEAD is on a branch", () => {
    render(<BranchTree />);
    expect(screen.queryByText(/Detached @/)).not.toBeInTheDocument();
  });
```

(The `beforeEach` already sets `tags: [{ name: "v1.0", targetOid: "a" }]`, so `headOid: "a"` matches it for the first test.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- BranchTree`
Expected: FAIL — no "Detached @ ..." text is ever rendered.

- [ ] **Step 3: Add the badge**

In `src/components/BranchTree.tsx`, destructure the new fields and render the badge right after the existing error line:

```tsx
  const { branches, tags, repos, activeRepoId, switchBranch, headDetached, headOid } = useWorkspaceStore();
```

```tsx
      {error && <div className="text-xs text-danger px-2 py-0.5">{error}</div>}
      {headDetached && (
        <div className="text-xs text-text-muted px-2 py-0.5 italic">
          Detached @ {tags.find((t) => t.targetOid === headOid)?.name ?? headOid?.slice(0, 7)}
        </div>
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- BranchTree`
Expected: PASS — all tests green.

---

### Task 7: `BranchTree` — tag checkout

**Files:**
- Modify: `src/components/BranchTree.tsx`
- Modify: `src/__tests__/BranchTree.test.tsx`

**Interfaces:**
- Consumes: `useWorkspaceStore().checkoutTag: (repoPath: string, tagName: string) => Promise<void>` (from Task 2).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/BranchTree.test.tsx`, add `checkoutTag: vi.fn().mockResolvedValue(undefined),` to the `beforeEach`'s store state, then add:

```tsx
  it("double-clicking a tag checks it out", async () => {
    const checkoutTag = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ checkoutTag });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("v1.0"));

    await waitFor(() => {
      expect(checkoutTag).toHaveBeenCalledWith("/tmp/a", "v1.0");
    });
  });

  it("shows an inline error when tag checkout fails", async () => {
    const checkoutTag = vi.fn().mockRejectedValue("cannot checkout a tag with uncommitted changes");
    useWorkspaceStore.setState({ checkoutTag });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("v1.0"));

    await waitFor(() => {
      expect(screen.getByText("cannot checkout a tag with uncommitted changes")).toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- BranchTree`
Expected: FAIL — the Tags block has no `onDoubleClick` handler, so nothing calls `checkoutTag`.

- [ ] **Step 3: Wire the handler**

In `src/components/BranchTree.tsx`, destructure `checkoutTag` and add a handler mirroring `handleSwitch`:

```tsx
  const { branches, tags, repos, activeRepoId, switchBranch, checkoutTag, headDetached, headOid } =
    useWorkspaceStore();
```

```tsx
  const handleCheckoutTag = async (tagName: string) => {
    setError(null);
    try {
      await checkoutTag(activeRepo?.path as string, tagName);
    } catch (e) {
      setError(String(e));
    }
  };
```

Update the Tags row markup:

```tsx
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- BranchTree`
Expected: PASS — all tests green.

---

### Task 8: `BranchTree` — collapsible Remotes section

**Files:**
- Modify: `src/components/BranchTree.tsx`
- Modify: `src/__tests__/BranchTree.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports — local component state only.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/BranchTree.test.tsx`, add:

```tsx
  it("hides remote branches by default", () => {
    render(<BranchTree />);
    expect(screen.queryByText("origin/main")).not.toBeInTheDocument();
    expect(screen.getByText("Remotes (1)")).toBeInTheDocument();
  });

  it("shows remote branches after clicking the Remotes header", () => {
    render(<BranchTree />);
    fireEvent.click(screen.getByText("Remotes (1)"));
    expect(screen.getByText("origin/main")).toBeInTheDocument();
  });
```

Note: the existing test `"renders local branches, remote branches, and tags in separate groups"` asserts `screen.getByText("origin/main")` is present on initial render — since Remotes now defaults to collapsed, update that test to first click the Remotes header:

```tsx
  it("renders local branches, remote branches, and tags in separate groups", () => {
    render(<BranchTree />);
    fireEvent.click(screen.getByText("Remotes (1)"));
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });
```

Similarly, `"hides branches that don't match the search query"` asserts `screen.getByText("origin/main")` after setting the search query — add a click on the Remotes header before that assertion:

```tsx
  it("hides branches that don't match the search query", async () => {
    const { useSearchStore } = await import("../store/searchStore");
    render(<BranchTree />);
    act(() => {
      useSearchStore.setState({ query: "orig" });
    });
    fireEvent.click(screen.getByText(/Remotes/));
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    act(() => {
      useSearchStore.setState({ query: "" });
    });
  });
```

And `"double-clicking a remote branch switches with isRemote true"` needs the Remotes section open before it can find `"origin/main"` to double-click:

```tsx
  it("double-clicking a remote branch switches with isRemote true", async () => {
    const switchBranch = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ switchBranch });

    render(<BranchTree />);
    fireEvent.click(screen.getByText("Remotes (1)"));
    fireEvent.doubleClick(screen.getByText("origin/main"));

    await waitFor(() => {
      expect(switchBranch).toHaveBeenCalledWith("/tmp/a", "origin/main", true);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- BranchTree`
Expected: FAIL — no "Remotes (1)" header text exists yet (it's currently a plain "Remotes" label), and remote branches currently always render.

- [ ] **Step 3: Add the collapsible section**

In `src/components/BranchTree.tsx`, import the two chevron icons, add local state, and replace the Remotes header + rows:

```tsx
import { useState } from "react";
import { GitBranch, Tag as TagIcon, ChevronDown, ChevronRight } from "lucide-react";
```

```tsx
  const [remotesCollapsed, setRemotesCollapsed] = useState(true);
```

```tsx
      <button
        type="button"
        className="flex items-center gap-1 w-full text-left text-xs uppercase text-text-muted mt-2 hover:text-text-primary"
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
```

- [ ] **Step 4: Run the full test suite to verify everything passes**

Run: `npm test`
Expected: PASS — all suites green (the pre-existing unrelated `Toolbar.test.tsx` "Push" failure from the prior round is expected to still be there — it's out of scope for this plan too).

---

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — no commit steps in this plan; each task's changes are simply saved to disk.
