# PR Author/Assignee/Reviewer User Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Author/Assignee/Reviewer free-text inputs with a real searchable dropdown of the repo's assignable users, the same way Base/Head branch already work.

**Architecture:** A new backend command mirrors the existing `list_github_branches` end-to-end (Rust function → Tauri command → `invoke*` wrapper → store field) exactly, just hitting `repos/{owner}/{repo}/assignees` instead of `.../branches`. A new `UserCombobox` component mirrors `BranchCombobox`'s popover/search/rank/loading UI but drops the branch-specific "Recent" section (backed by `recentBranches.ts`, which stays branch-only). `PullRequestsScreen` swaps three `renderFilterControl` cases from plain `<input>`s to `UserCombobox`, all sharing one `assignableUsers` list loaded once per repo alongside branches.

**Tech Stack:** Rust + git2/gh CLI (`src-tauri`), React 18 + TypeScript + Zustand, Tailwind CSS, Vitest + @testing-library/react. No new dependencies.

## Global Constraints

- This project is intentionally not tracked in git (explicit prior decision — no `git init`/`git add`/`git commit`; each task ends by running tests, not committing).
- Follow `list_branches`/`list_github_branches`'s exact existing pattern for the new backend piece — same `gh api ... --paginate --jq` shape, same `resolve_owner_repo`-inside-`run_blocking` wrapper shape, same `branches`/`isLoadingBranches`/`loadBranches` store shape.
- `UserCombobox` has no Recent section — don't reuse `recentBranches.ts` for it.
- Tests that interact with the Filters-visibility popover and then need to query the newly-shown field by its wrapping `<label>` text must close the popover first (a second click on the "Filters" button) — otherwise the popover's own checkbox (also labeled with that field's name) and the newly-rendered field make `getByLabelText` ambiguous.

---

### Task 1: Backend — `list_assignable_users`

**Files:**
- Modify: `src-tauri/src/github.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: existing `GhRunner` trait, `FakeGhRunner` test double, `resolve_owner_repo`.
- Produces: `pub fn list_assignable_users(runner: &dyn GhRunner, owner: &str, repo: &str) -> Result<Vec<String>, AppError>` in `github.rs`, wrapped by the Tauri command `list_assignable_users` in `commands.rs`, consumed by Task 2's frontend invoke wrapper.

- [ ] **Step 1: Write the failing Rust tests**

In `src-tauri/src/github.rs`'s `mod gh_client_tests`, add these three tests right after the three existing `list_branches_*` tests (before the module's closing `}`):

```rust
    #[test]
    fn list_assignable_users_parses_newline_separated_logins() {
        let runner = FakeGhRunner::ok("alice\nbob\ncarol\n");

        let users = list_assignable_users(&runner, "acme", "widgets").unwrap();

        assert_eq!(users, vec!["alice", "bob", "carol"]);
    }

    #[test]
    fn list_assignable_users_ignores_blank_lines() {
        let runner = FakeGhRunner::ok("alice\n\nbob\n");

        let users = list_assignable_users(&runner, "acme", "widgets").unwrap();

        assert_eq!(users, vec!["alice", "bob"]);
    }

    #[test]
    fn list_assignable_users_calls_gh_api_with_paginate_and_repo() {
        let runner = FakeGhRunner::ok("alice\n");

        list_assignable_users(&runner, "acme", "widgets").unwrap();

        let calls = runner.calls.borrow();
        let args = &calls[0];
        assert_eq!(args[0], "api");
        assert!(args.contains(&"repos/acme/widgets/assignees".to_string()));
        assert!(args.contains(&"--paginate".to_string()));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib github::gh_client_tests::list_assignable_users`
Expected: FAIL to compile — `list_assignable_users` doesn't exist yet.

- [ ] **Step 3: Implement the function**

In `src-tauri/src/github.rs`, add this right after `list_branches`:

```rust
/// Lists users who can be assigned issues/PRs in the repo — used as a
/// stand-in "possible people" list for author/assignee/reviewer filters,
/// since PR authors and reviewers are practically always collaborators too.
pub fn list_assignable_users(runner: &dyn GhRunner, owner: &str, repo: &str) -> Result<Vec<String>, AppError> {
    let endpoint = format!("repos/{owner}/{repo}/assignees");
    let output = runner.run(&["api", &endpoint, "--paginate", "--jq", ".[].login"])?;
    Ok(output.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib github::gh_client_tests`
Expected: PASS — all tests in the module green, including the three new ones.

- [ ] **Step 5: Add the Tauri command**

In `src-tauri/src/commands.rs`, add right after `list_github_branches`:

```rust
#[tauri::command]
pub async fn list_assignable_users(repo_path: String) -> Result<Vec<String>, AppError> {
    run_blocking(move || {
        let (owner, repo) = github::resolve_owner_repo(&repo_path)?;
        github::list_assignable_users(&SystemGhRunner, &owner, &repo)
    })
    .await
}
```

In `src-tauri/src/lib.rs`, add `commands::list_assignable_users,` to the `tauri::generate_handler![...]` list, right after `commands::list_github_branches,`.

- [ ] **Step 6: Run the full Rust suite to verify nothing else broke**

Run: `cargo test`
Expected: PASS — all suites green.

---

### Task 2: Frontend store plumbing

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/store/githubStore.ts`
- Modify: `src/__tests__/githubStore.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useGithubStore().assignableUsers: string[]`, `isLoadingAssignableUsers: boolean`, `loadAssignableUsers: (repoPath: string) => Promise<void>`, consumed by Task 4.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/githubStore.test.ts`, add `invokeListAssignableUsers: vi.fn(),` to the `vi.mock("../lib/tauri", ...)` block, then add:

```ts
  it("loadAssignableUsers populates assignableUsers from the backend", async () => {
    (tauriLib.invokeListAssignableUsers as any).mockResolvedValue(["alice", "bob"]);

    await useGithubStore.getState().loadAssignableUsers("/tmp/a");

    expect(tauriLib.invokeListAssignableUsers).toHaveBeenCalledWith("/tmp/a");
    expect(useGithubStore.getState().assignableUsers).toEqual(["alice", "bob"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- githubStore`
Expected: FAIL — `loadAssignableUsers` doesn't exist on the store yet.

- [ ] **Step 3: Add the invoke wrapper**

In `src/lib/tauri.ts`, add right after `invokeListGithubBranches`:

```ts
export const invokeListAssignableUsers = (repoPath: string) =>
  invoke<string[]>("list_assignable_users", { repoPath });
```

- [ ] **Step 4: Add the store field**

In `src/store/githubStore.ts`, import `invokeListAssignableUsers` alongside `invokeListGithubBranches`, add to `GithubState`:

```ts
  assignableUsers: string[];
  isLoadingAssignableUsers: boolean;
  loadAssignableUsers: (repoPath: string) => Promise<void>;
```

and add the implementation right after `loadBranches`:

```ts
  assignableUsers: [],
  isLoadingAssignableUsers: false,
  loadAssignableUsers: async (repoPath: string) => {
    set({ isLoadingAssignableUsers: true });
    try {
      const assignableUsers = await invokeListAssignableUsers(repoPath);
      set({ assignableUsers });
    } finally {
      set({ isLoadingAssignableUsers: false });
    }
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- githubStore`
Expected: PASS — all tests green, including the new one.

---

### Task 3: `UserCombobox` component

**Files:**
- Create: `src/components/UserCombobox.tsx`
- Test: `src/__tests__/UserCombobox.test.tsx`

**Interfaces:**
- Consumes: `rankMatches` from `../lib/fuzzyMatch` (existing, unchanged).
- Produces: `export default function UserCombobox(props: { value: string | undefined; onChange: (value: string | null) => void; options: string[]; isLoading?: boolean }): JSX.Element`, consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/UserCombobox.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UserCombobox from "../components/UserCombobox";

const options = ["alice", "bob", "carol"];

describe("UserCombobox", () => {
  it("shows 'Any' when no value is selected", () => {
    render(<UserCombobox value={undefined} onChange={vi.fn()} options={options} />);
    expect(screen.getByRole("button")).toHaveTextContent("Any");
  });

  it("shows the selected value on the trigger", () => {
    render(<UserCombobox value="bob" onChange={vi.fn()} options={options} />);
    expect(screen.getByRole("button")).toHaveTextContent("bob");
  });

  it("opens a popover listing all options on click", () => {
    render(<UserCombobox value={undefined} onChange={vi.fn()} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    options.forEach((o) => expect(screen.getByText(o)).toBeInTheDocument());
  });

  it("filters the list as the user types", () => {
    render(<UserCombobox value={undefined} onChange={vi.fn()} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Jump to user..."), { target: { value: "bo" } });
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
  });

  it("ranks substring matches before fuzzy-only matches", () => {
    const rankedOptions = ["bxoxb", "bob", "bobby"];
    const { container } = render(<UserCombobox value={undefined} onChange={vi.fn()} options={rankedOptions} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Jump to user..."), { target: { value: "bob" } });
    const names = Array.from(container.querySelectorAll(".row-name")).map((el) => el.textContent);
    expect(names).toEqual(["Any", "bob", "bobby", "bxoxb"]);
  });

  it("calls onChange and closes when an option is clicked", () => {
    const onChange = vi.fn();
    render(<UserCombobox value={undefined} onChange={onChange} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("bob"));
    expect(onChange).toHaveBeenCalledWith("bob");
    expect(screen.queryByPlaceholderText("Jump to user...")).not.toBeInTheDocument();
  });

  it("calls onChange(null) when 'Any' is clicked", () => {
    const onChange = vi.fn();
    render(<UserCombobox value="bob" onChange={onChange} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Any"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selects the highlighted row on Enter", () => {
    const onChange = vi.fn();
    render(<UserCombobox value={undefined} onChange={onChange} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByPlaceholderText("Jump to user...");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("alice");
  });

  it("closes without calling onChange on Escape", () => {
    const onChange = vi.fn();
    render(<UserCombobox value={undefined} onChange={onChange} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(screen.getByPlaceholderText("Jump to user..."), { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Jump to user...")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <UserCombobox value={undefined} onChange={vi.fn()} options={options} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByPlaceholderText("Jump to user...")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByPlaceholderText("Jump to user...")).not.toBeInTheDocument();
  });

  it("shows a spinner and disables the trigger while loading", () => {
    render(<UserCombobox value={undefined} onChange={vi.fn()} options={[]} isLoading />);
    const trigger = screen.getByRole("button");
    expect(trigger).toBeDisabled();
    expect(trigger.querySelector(".animate-spin")).not.toBeNull();
  });

  it("tags the row matching the current value as current", () => {
    render(<UserCombobox value="bob" onChange={vi.fn()} options={options} />);
    fireEvent.click(screen.getByRole("button", { name: "bob" }));
    const row = screen.getByText("bob", { selector: ".row-name" }).closest("div");
    expect(row).toHaveTextContent("current");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- UserCombobox`
Expected: FAIL — `Cannot find module '../components/UserCombobox'`.

- [ ] **Step 3: Write the component**

Create `src/components/UserCombobox.tsx`:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { rankMatches } from "../lib/fuzzyMatch";

interface UserComboboxProps {
  value: string | undefined;
  onChange: (value: string | null) => void;
  options: string[];
  isLoading?: boolean;
}

export default function UserCombobox({ value, onChange, options, isLoading }: UserComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = rankMatches(filterText, options, (o) => o);
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
        className="w-28 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary text-left truncate flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-wait"
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
              placeholder="Jump to user..."
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- UserCombobox`
Expected: PASS — all 12 tests green.

---

### Task 4: Wire `UserCombobox` into `PullRequestsScreen`

**Files:**
- Modify: `src/components/PullRequestsScreen.tsx`
- Modify: `src/__tests__/PullRequestsScreen.test.tsx`

**Interfaces:**
- Consumes: `UserCombobox` from Task 3, `assignableUsers`/`isLoadingAssignableUsers`/`loadAssignableUsers` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Update the test file**

In `src/__tests__/PullRequestsScreen.test.tsx`, add `invokeListAssignableUsers: vi.fn(),` to the `vi.mock("../lib/tauri", ...)` block, and in `beforeEach` add a default resolved value right after the existing `invokeListGithubBranches` mock:

```ts
    (tauriLib.invokeListAssignableUsers as any).mockResolvedValue(["yarinmag", "octocat"]);
```

Replace the existing `"typing in the author filter updates the qualifier query"` test with:

```tsx
  it("selecting an author updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Author"));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ })); // close the menu
    fireEvent.click(screen.getByLabelText("Author"));
    fireEvent.click(screen.getByText("yarinmag"));
    expect(useGithubStore.getState().query).toBe("author:yarinmag");
  });

  it("selecting an assignee updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Assignee"));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Assignee"));
    fireEvent.click(screen.getByText("octocat"));
    expect(useGithubStore.getState().query).toBe("assignee:octocat");
  });

  it("selecting a reviewer updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Reviewer"));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Reviewer"));
    fireEvent.click(screen.getByText("yarinmag"));
    expect(useGithubStore.getState().query).toBe("review-requested:yarinmag");
  });

  it("fetches assignable users on mount", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(tauriLib.invokeListAssignableUsers).toHaveBeenCalledWith("/tmp/a");
    });
  });
```

Replace the existing `"adding Author via the Filters menu shows it"` test (its old assertion used `getByPlaceholderText("Author")`, which no longer exists since Author is now a combobox, not a text input):

```tsx
  it("adding Author via the Filters menu shows it", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Author"));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ })); // close the menu
    expect(screen.getByLabelText("Author")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- PullRequestsScreen`
Expected: FAIL — Author/Assignee/Reviewer are still plain text inputs, `invokeListAssignableUsers` is never called.

- [ ] **Step 3: Wire the component**

In `src/components/PullRequestsScreen.tsx`, add the import:

```tsx
import UserCombobox from "./UserCombobox";
```

Destructure the new store fields alongside `branches`/`isLoadingBranches`/`loadBranches`:

```tsx
    branches,
    isLoadingBranches,
    loadBranches,
    assignableUsers,
    isLoadingAssignableUsers,
    loadAssignableUsers,
```

Add `loadAssignableUsers(activeRepo.path)` to the mount effect, alongside the existing `loadBranches` call:

```tsx
  useEffect(() => {
    if (activeRepo && (!status || status.available)) {
      searchPullRequests(activeRepo.path);
      loadBranches(activeRepo.path);
      loadAssignableUsers(activeRepo.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepo?.path, status?.available]);
```

In `renderFilterControl`, replace the `"author"`, `"assignee"`, and `"review-requested"` cases:

```tsx
      case "author":
        return (
          <UserCombobox
            value={getQualifier(query, "author")}
            onChange={(v) => setQualifier("author", v)}
            options={assignableUsers}
            isLoading={isLoadingAssignableUsers}
          />
        );
      case "assignee":
        return (
          <UserCombobox
            value={getQualifier(query, "assignee")}
            onChange={(v) => setQualifier("assignee", v)}
            options={assignableUsers}
            isLoading={isLoadingAssignableUsers}
          />
        );
      case "review-requested":
        return (
          <UserCombobox
            value={getQualifier(query, "review-requested")}
            onChange={(v) => setQualifier("review-requested", v)}
            options={assignableUsers}
            isLoading={isLoadingAssignableUsers}
          />
        );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- PullRequestsScreen`
Expected: PASS — all tests green.

- [ ] **Step 5: Run the full suite and type check**

Run: `npm test && npx tsc --noEmit` and (from `src-tauri`) `cargo test`
Expected: PASS — every suite green except the pre-existing, unrelated `Toolbar.test.tsx` "Push" failure (flagged in prior rounds, out of scope); no TypeScript errors.

---

## Notes

Per project convention (see local memory), this project is intentionally not tracked in git — no commit steps in this plan; each task's changes are simply saved to disk.
