# Per-repo settings (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store ticket pattern, Jira base URL and worktree folder per repository, and make release notes and the dirty-checkout dialog honor them.

**Architecture:** A `repo_settings` SQLite table keyed by repo path, exposed through three Tauri commands. A frontend zustand store caches settings per path and a `useRepoSettings` hook returns stored values or defaults. Existing features read the hook; a new "Repository" section in the Settings modal (opened from the gear or a repo's right-click menu) edits them.

**Tech Stack:** Rust (rusqlite, serde, Tauri v2), React 18 + TypeScript, zustand, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-06-per-repo-settings-design.md`

**No git:** this project is deliberately not tracked in git, so there are no commit steps. Each task ends with a "checkpoint" that runs the test suites instead.

## Global Constraints

- Settings are keyed by repo **path** (the exact `repos.path` string), never by repo id.
- Defaults, verbatim: `ticketPattern` = `CEM-\d+`, `jiraBaseUrl` = `https://cemento.atlassian.net/browse/`, `worktreeDir` = `` (empty).
- `RepoSettings` serializes camelCase: `{ ticketPattern, jiraBaseUrl, worktreeDir }`.
- No row means defaults; there is no migration.
- Clearing `ticketPattern` or `jiraBaseUrl` disables Jira linking for that repo.
- Rust validation: `jiraBaseUrl` empty or starts with `http://`/`https://` (a missing trailing `/` is added); `worktreeDir` empty or absolute. Rust does not compile the regex; the frontend does.
- A repo with no stored settings must behave exactly as today.
- Test commands: `cd src-tauri && cargo test`; `npm test`; `npx tsc --noEmit` (from the project root).
- The one known pre-existing Vitest "Unhandled Error" from `Toolbar.test.tsx` ("Cannot read properties of undefined (reading 'find')") is unrelated; do not try to fix it, but do report any *new* failure.

## Review Focus

Inputs the spec implies but its tests don't obviously cover; each has a pinned test in the owning task:

1. Pattern with alternation (`CEM-\d+|ABC-\d+`) must still link both ids — Task 3.
2. Pattern with capture groups must link the whole id, not a group — Task 3.
3. A stored pattern that is not a valid regex (`CEM-(`) must not crash; notes come out plain — Task 3.
4. A Jira URL typed without a trailing slash: the form must show the normalized value the backend stored after Save — Task 5.
5. Picking a different repo in the Settings picker and saving must write to the picked repo, not the active one — Task 5.
6. `worktreeDir` typed with a trailing slash must not produce `//` in the default worktree path — Task 4.

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/db.rs` (modify) | `RepoSettings`, table, get/set/reset, validation |
| `src-tauri/src/commands.rs` (modify) | three Tauri commands |
| `src-tauri/src/lib.rs` (modify) | register commands |
| `src/lib/repoSettings.ts` (create) | `RepoSettings` type, defaults, regex helpers (pure) |
| `src/lib/tauri.ts` (modify) | invoke wrappers |
| `src/store/repoSettingsStore.ts` (create) | per-path cache, load/save/reset |
| `src/hooks/useRepoSettings.ts` (create) | hook: stored settings or defaults |
| `src/lib/releaseNotes.ts` (modify) | formatter uses pattern + URL |
| `src/components/ReleaseNotesDialog.tsx` (modify) | reads settings |
| `src/lib/dirtyCheckout.ts`, `src/components/DirtyCheckoutDialog.tsx` (modify) | worktree folder |
| `src/store/settingsModalStore.ts` (create) | open/close + preselected repo |
| `src/components/RepoSettingsSection.tsx` (create) | the form |
| `src/components/SettingsModal.tsx`, `Sidebar.tsx`, `RepoList.tsx` (modify) | wiring |

---

### Task 1: Rust storage and commands

**Files:**
- Modify: `src-tauri/src/db.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces (Rust): `db::RepoSettings { ticket_pattern, jira_base_url, worktree_dir }`, `db::get_repo_settings(&Connection, &str) -> Result<RepoSettings, AppError>`, `db::set_repo_settings(&Connection, &str, &RepoSettings) -> Result<RepoSettings, AppError>` (returns the normalized stored value), `db::reset_repo_settings(&Connection, &str) -> Result<(), AppError>`.
- Produces (Tauri commands): `get_repo_settings(repo_path)`, `set_repo_settings(repo_path, settings)`, `reset_repo_settings(repo_path)`.

- [ ] **Step 1: Add the type and stub functions so tests compile**

In `src-tauri/src/db.rs` change the imports at the top to:

```rust
use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
```

Add below `remove_repo`:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSettings {
    pub ticket_pattern: String,
    pub jira_base_url: String,
    pub worktree_dir: String,
}

impl Default for RepoSettings {
    fn default() -> Self {
        Self {
            ticket_pattern: r"CEM-\d+".into(),
            jira_base_url: "https://cemento.atlassian.net/browse/".into(),
            worktree_dir: String::new(),
        }
    }
}

pub fn get_repo_settings(_conn: &Connection, _path: &str) -> Result<RepoSettings, AppError> {
    Ok(RepoSettings::default())
}

pub fn set_repo_settings(
    _conn: &Connection,
    _path: &str,
    _settings: &RepoSettings,
) -> Result<RepoSettings, AppError> {
    Ok(RepoSettings::default())
}

pub fn reset_repo_settings(_conn: &Connection, _path: &str) -> Result<(), AppError> {
    Ok(())
}
```

- [ ] **Step 2: Write the failing tests**

Append inside the existing `mod tests` in `db.rs` (it already has `setup()` returning an in-memory `Connection` with `init_db` applied):

```rust
    fn custom() -> RepoSettings {
        RepoSettings {
            ticket_pattern: r"ABC-\d+".into(),
            jira_base_url: "https://jira.example.com/browse/".into(),
            worktree_dir: "/tmp/wt".into(),
        }
    }

    #[test]
    fn repo_settings_default_when_no_row() {
        let conn = setup();
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), RepoSettings::default());
    }

    #[test]
    fn repo_settings_round_trip_and_overwrite() {
        let conn = setup();
        assert_eq!(set_repo_settings(&conn, "/r", &custom()).unwrap(), custom());
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), custom());

        let mut next = custom();
        next.ticket_pattern = r"XYZ-\d+".into();
        set_repo_settings(&conn, "/r", &next).unwrap();
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), next);
        // other repos are untouched
        assert_eq!(get_repo_settings(&conn, "/other").unwrap(), RepoSettings::default());
    }

    #[test]
    fn repo_settings_reset_restores_defaults() {
        let conn = setup();
        set_repo_settings(&conn, "/r", &custom()).unwrap();
        reset_repo_settings(&conn, "/r").unwrap();
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), RepoSettings::default());
    }

    #[test]
    fn repo_settings_adds_missing_trailing_slash_to_url() {
        let conn = setup();
        let mut s = custom();
        s.jira_base_url = "https://jira.example.com/browse".into();
        let stored = set_repo_settings(&conn, "/r", &s).unwrap();
        assert_eq!(stored.jira_base_url, "https://jira.example.com/browse/");
    }

    #[test]
    fn repo_settings_rejects_non_http_url() {
        let conn = setup();
        let mut s = custom();
        s.jira_base_url = "ftp://jira.example.com/".into();
        assert!(set_repo_settings(&conn, "/r", &s).is_err());
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), RepoSettings::default());
    }

    #[test]
    fn repo_settings_rejects_relative_worktree_dir() {
        let conn = setup();
        let mut s = custom();
        s.worktree_dir = "relative/dir".into();
        assert!(set_repo_settings(&conn, "/r", &s).is_err());
    }

    #[test]
    fn repo_settings_allow_empty_pattern_and_url_to_disable_linking() {
        let conn = setup();
        let s = RepoSettings { ticket_pattern: String::new(), jira_base_url: String::new(), worktree_dir: String::new() };
        assert_eq!(set_repo_settings(&conn, "/r", &s).unwrap(), s);
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), s);
    }

    #[test]
    fn repo_settings_survive_remove_and_readd_of_the_same_path() {
        let conn = setup();
        let repo = add_repo(&conn, "/r", "r").unwrap();
        set_repo_settings(&conn, "/r", &custom()).unwrap();
        remove_repo(&conn, repo.id).unwrap();
        add_repo(&conn, "/r", "r").unwrap();
        assert_eq!(get_repo_settings(&conn, "/r").unwrap(), custom());
    }
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `cd src-tauri && cargo test repo_settings`
Expected: compiles; `round_trip`, `reset` (after set), `adds_missing_trailing_slash`, `rejects_*`, `allow_empty_*` and `survive_*` FAIL (stubs return defaults); `default_when_no_row` passes.

- [ ] **Step 4: Implement**

In `init_db`, add after the `repos` table creation:

```rust
    conn.execute(
        "CREATE TABLE IF NOT EXISTS repo_settings (
            path TEXT PRIMARY KEY,
            ticket_pattern TEXT NOT NULL,
            jira_base_url TEXT NOT NULL,
            worktree_dir TEXT NOT NULL
        )",
        [],
    )?;
```

Replace the three stub functions with:

```rust
fn normalize_repo_settings(s: &RepoSettings) -> Result<RepoSettings, AppError> {
    let mut url = s.jira_base_url.trim().to_string();
    if !url.is_empty() {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err(AppError::Operation(
                "Jira base URL must start with http:// or https://".into(),
            ));
        }
        if !url.ends_with('/') {
            url.push('/');
        }
    }
    let dir = s.worktree_dir.trim().to_string();
    if !dir.is_empty() && !std::path::Path::new(&dir).is_absolute() {
        return Err(AppError::Operation("Worktree folder must be an absolute path".into()));
    }
    Ok(RepoSettings {
        ticket_pattern: s.ticket_pattern.trim().to_string(),
        jira_base_url: url,
        worktree_dir: dir,
    })
}

pub fn get_repo_settings(conn: &Connection, path: &str) -> Result<RepoSettings, AppError> {
    let row = conn
        .query_row(
            "SELECT ticket_pattern, jira_base_url, worktree_dir FROM repo_settings WHERE path = ?1",
            params![path],
            |row| {
                Ok(RepoSettings {
                    ticket_pattern: row.get(0)?,
                    jira_base_url: row.get(1)?,
                    worktree_dir: row.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(row.unwrap_or_default())
}

pub fn set_repo_settings(
    conn: &Connection,
    path: &str,
    settings: &RepoSettings,
) -> Result<RepoSettings, AppError> {
    let normalized = normalize_repo_settings(settings)?;
    conn.execute(
        "INSERT OR REPLACE INTO repo_settings (path, ticket_pattern, jira_base_url, worktree_dir)
         VALUES (?1, ?2, ?3, ?4)",
        params![path, normalized.ticket_pattern, normalized.jira_base_url, normalized.worktree_dir],
    )?;
    Ok(normalized)
}

pub fn reset_repo_settings(conn: &Connection, path: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM repo_settings WHERE path = ?1", params![path])?;
    Ok(())
}
```

Append to `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub async fn get_repo_settings(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<db::RepoSettings, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::get_repo_settings(&conn, &repo_path)
    })
    .await
}

#[tauri::command]
pub async fn set_repo_settings(
    state: State<'_, AppState>,
    repo_path: String,
    settings: db::RepoSettings,
) -> Result<db::RepoSettings, AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::set_repo_settings(&conn, &repo_path, &settings)
    })
    .await
}

#[tauri::command]
pub async fn reset_repo_settings(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<(), AppError> {
    let db = state.db.clone();
    run_blocking(move || {
        let conn = db.lock().unwrap();
        db::reset_repo_settings(&conn, &repo_path)
    })
    .await
}
```

In `src-tauri/src/lib.rs`, add after `commands::release_notes_commits,` in `generate_handler!`:

```rust
            commands::get_repo_settings,
            commands::set_repo_settings,
            commands::reset_repo_settings,
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `cd src-tauri && cargo test`
Expected: all pass (the 8 new `repo_settings_*` tests included), no new warnings from `db.rs`.

- [ ] **Step 6: Checkpoint**

Run: `cd src-tauri && cargo test 2>&1 | grep -E "test result|FAILED"`
Expected: `0 failed`.

---

### Task 2: Frontend foundation (types, wrappers, store, hook)

**Files:**
- Create: `src/lib/repoSettings.ts`, `src/store/repoSettingsStore.ts`, `src/hooks/useRepoSettings.ts`
- Modify: `src/lib/tauri.ts`
- Test: `src/__tests__/repoSettings.test.ts`, `src/__tests__/repoSettingsStore.test.tsx`

**Interfaces:**
- Consumes: Tauri commands from Task 1.
- Produces:
  - `RepoSettings { ticketPattern: string; jiraBaseUrl: string; worktreeDir: string }`, `DEFAULT_REPO_SETTINGS`
  - `compileTicketPattern(pattern: string): RegExp | null` (global, wrapped as `\b(?:pattern)\b`; `null` if empty or invalid)
  - `ticketPatternError(pattern: string): string | null`
  - `linkingConfigured(s: RepoSettings): boolean`
  - `invokeGetRepoSettings(repoPath)`, `invokeSetRepoSettings(repoPath, settings)`, `invokeResetRepoSettings(repoPath)`
  - `useRepoSettingsStore` with `byPath`, `load(path)`, `save(path, settings): Promise<RepoSettings>`, `reset(path): Promise<void>`
  - `useRepoSettings(path: string | null | undefined): RepoSettings`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/repoSettings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_REPO_SETTINGS,
  compileTicketPattern,
  ticketPatternError,
  linkingConfigured,
} from "../lib/repoSettings";

describe("repoSettings helpers", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_REPO_SETTINGS).toEqual({
      ticketPattern: "CEM-\\d+",
      jiraBaseUrl: "https://cemento.atlassian.net/browse/",
      worktreeDir: "",
    });
  });

  it("compiles a pattern into a whole-word global regex", () => {
    const re = compileTicketPattern("CEM-\\d+")!;
    expect("fix CEM-12 and CEM-34".match(re)).toEqual(["CEM-12", "CEM-34"]);
    expect("XCEM-12".match(re)).toBeNull();
  });

  it("returns null for an empty or invalid pattern", () => {
    expect(compileTicketPattern("")).toBeNull();
    expect(compileTicketPattern("   ")).toBeNull();
    expect(compileTicketPattern("CEM-(")).toBeNull();
  });

  it("reports a readable error only for an invalid pattern", () => {
    expect(ticketPatternError("CEM-\\d+")).toBeNull();
    expect(ticketPatternError("")).toBeNull();
    expect(ticketPatternError("CEM-(")).toMatch(/./);
  });

  it("linking needs both a valid pattern and a URL", () => {
    expect(linkingConfigured(DEFAULT_REPO_SETTINGS)).toBe(true);
    expect(linkingConfigured({ ...DEFAULT_REPO_SETTINGS, jiraBaseUrl: "" })).toBe(false);
    expect(linkingConfigured({ ...DEFAULT_REPO_SETTINGS, ticketPattern: "" })).toBe(false);
    expect(linkingConfigured({ ...DEFAULT_REPO_SETTINGS, ticketPattern: "CEM-(" })).toBe(false);
  });
});
```

`src/__tests__/repoSettingsStore.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeGetRepoSettings: vi.fn(),
  invokeSetRepoSettings: vi.fn(),
  invokeResetRepoSettings: vi.fn(),
}));

import * as tauri from "../lib/tauri";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useRepoSettings } from "../hooks/useRepoSettings";
import { useToastStore } from "../store/toastStore";

const custom = { ticketPattern: "ABC-\\d+", jiraBaseUrl: "https://j.example.com/", worktreeDir: "/wt" };

describe("repoSettingsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRepoSettingsStore.setState({ byPath: {} });
    useToastStore.setState({ toasts: [] });
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(custom);
    vi.mocked(tauri.invokeSetRepoSettings).mockImplementation(async (_p, s) => s);
    vi.mocked(tauri.invokeResetRepoSettings).mockResolvedValue(undefined);
  });

  it("loads once per path and caches", async () => {
    await useRepoSettingsStore.getState().load("/r");
    await useRepoSettingsStore.getState().load("/r");
    expect(tauri.invokeGetRepoSettings).toHaveBeenCalledTimes(1);
    expect(useRepoSettingsStore.getState().byPath["/r"]).toEqual(custom);
  });

  it("falls back to defaults and toasts when loading fails", async () => {
    vi.mocked(tauri.invokeGetRepoSettings).mockRejectedValue("db locked");
    await useRepoSettingsStore.getState().load("/r");
    expect(useRepoSettingsStore.getState().byPath["/r"]).toEqual(DEFAULT_REPO_SETTINGS);
    expect(useToastStore.getState().toasts[0].message).toContain("db locked");
  });

  it("save stores the value the backend returns (it may normalize)", async () => {
    vi.mocked(tauri.invokeSetRepoSettings).mockResolvedValue({ ...custom, jiraBaseUrl: "https://j.example.com/browse/" });
    const saved = await useRepoSettingsStore.getState().save("/r", { ...custom, jiraBaseUrl: "https://j.example.com/browse" });
    expect(saved.jiraBaseUrl).toBe("https://j.example.com/browse/");
    expect(useRepoSettingsStore.getState().byPath["/r"].jiraBaseUrl).toBe("https://j.example.com/browse/");
  });

  it("save rethrows backend errors and keeps the old value", async () => {
    useRepoSettingsStore.setState({ byPath: { "/r": custom } });
    vi.mocked(tauri.invokeSetRepoSettings).mockRejectedValue("bad url");
    await expect(useRepoSettingsStore.getState().save("/r", DEFAULT_REPO_SETTINGS)).rejects.toBe("bad url");
    expect(useRepoSettingsStore.getState().byPath["/r"]).toEqual(custom);
  });

  it("reset restores defaults", async () => {
    useRepoSettingsStore.setState({ byPath: { "/r": custom } });
    await useRepoSettingsStore.getState().reset("/r");
    expect(tauri.invokeResetRepoSettings).toHaveBeenCalledWith("/r");
    expect(useRepoSettingsStore.getState().byPath["/r"]).toEqual(DEFAULT_REPO_SETTINGS);
  });
});

describe("useRepoSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRepoSettingsStore.setState({ byPath: {} });
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(custom);
  });

  it("returns defaults first, then the stored settings", async () => {
    const { result } = renderHook(() => useRepoSettings("/r"));
    expect(result.current).toEqual(DEFAULT_REPO_SETTINGS);
    await waitFor(() => expect(result.current).toEqual(custom));
  });

  it("returns defaults and loads nothing without a path", () => {
    const { result } = renderHook(() => useRepoSettings(null));
    expect(result.current).toEqual(DEFAULT_REPO_SETTINGS);
    expect(tauri.invokeGetRepoSettings).not.toHaveBeenCalled();
  });

  it("updates when the store changes", async () => {
    const { result } = renderHook(() => useRepoSettings("/r"));
    await waitFor(() => expect(result.current).toEqual(custom));
    act(() => useRepoSettingsStore.setState({ byPath: { "/r": DEFAULT_REPO_SETTINGS } }));
    expect(result.current).toEqual(DEFAULT_REPO_SETTINGS);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/__tests__/repoSettings.test.ts src/__tests__/repoSettingsStore.test.tsx`
Expected: FAIL, cannot resolve `../lib/repoSettings` / `../store/repoSettingsStore`.

- [ ] **Step 3: Implement**

`src/lib/repoSettings.ts`:

```ts
export interface RepoSettings {
  ticketPattern: string;
  jiraBaseUrl: string;
  worktreeDir: string;
}

export const DEFAULT_REPO_SETTINGS: RepoSettings = {
  ticketPattern: "CEM-\\d+",
  jiraBaseUrl: "https://cemento.atlassian.net/browse/",
  worktreeDir: "",
};

/** Whole-word, global regex for ticket ids; null when empty or not a valid regex. */
export function compileTicketPattern(pattern: string): RegExp | null {
  if (!pattern.trim()) return null;
  try {
    return new RegExp(`\\b(?:${pattern.trim()})\\b`, "g");
  } catch {
    return null;
  }
}

/** A readable message when `pattern` is not a valid regex; null if fine or empty. */
export function ticketPatternError(pattern: string): string | null {
  if (!pattern.trim()) return null;
  try {
    new RegExp(pattern.trim());
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid pattern";
  }
}

export function linkingConfigured(s: RepoSettings): boolean {
  return compileTicketPattern(s.ticketPattern) !== null && s.jiraBaseUrl.trim() !== "";
}
```

In `src/lib/tauri.ts` add at the top with the other imports `import type { RepoSettings } from "./repoSettings";` and append:

```ts

export const invokeGetRepoSettings = (repoPath: string) =>
  invoke<RepoSettings>("get_repo_settings", { repoPath });

export const invokeSetRepoSettings = (repoPath: string, settings: RepoSettings) =>
  invoke<RepoSettings>("set_repo_settings", { repoPath, settings });

export const invokeResetRepoSettings = (repoPath: string) =>
  invoke<void>("reset_repo_settings", { repoPath });
```

`src/store/repoSettingsStore.ts`:

```ts
import { create } from "zustand";
import { DEFAULT_REPO_SETTINGS, type RepoSettings } from "../lib/repoSettings";
import { invokeGetRepoSettings, invokeSetRepoSettings, invokeResetRepoSettings } from "../lib/tauri";
import { toast } from "./toastStore";

interface RepoSettingsState {
  /** Settings by repo path; a path is absent until its first load. */
  byPath: Record<string, RepoSettings>;
  load: (path: string) => Promise<void>;
  /** Saves and caches the value the backend stored (it may normalize it). Throws on failure. */
  save: (path: string, settings: RepoSettings) => Promise<RepoSettings>;
  reset: (path: string) => Promise<void>;
}

export const useRepoSettingsStore = create<RepoSettingsState>((set, get) => ({
  byPath: {},
  load: async (path) => {
    if (get().byPath[path]) return;
    try {
      const settings = await invokeGetRepoSettings(path);
      set((s) => ({ byPath: { ...s.byPath, [path]: settings } }));
    } catch (e) {
      // Cache the defaults so a failing load is not retried on every render.
      set((s) => ({ byPath: { ...s.byPath, [path]: DEFAULT_REPO_SETTINGS } }));
      toast.error(`Couldn't load repo settings: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
  save: async (path, settings) => {
    const stored = await invokeSetRepoSettings(path, settings);
    set((s) => ({ byPath: { ...s.byPath, [path]: stored } }));
    return stored;
  },
  reset: async (path) => {
    await invokeResetRepoSettings(path);
    set((s) => ({ byPath: { ...s.byPath, [path]: DEFAULT_REPO_SETTINGS } }));
  },
}));
```

`src/hooks/useRepoSettings.ts`:

```ts
import { useEffect } from "react";
import { DEFAULT_REPO_SETTINGS, type RepoSettings } from "../lib/repoSettings";
import { useRepoSettingsStore } from "../store/repoSettingsStore";

/** The repo's stored settings, or the defaults until they load (or without a repo). */
export function useRepoSettings(path: string | null | undefined): RepoSettings {
  const stored = useRepoSettingsStore((s) => (path ? s.byPath[path] : undefined));
  useEffect(() => {
    if (path) void useRepoSettingsStore.getState().load(path);
  }, [path]);
  return stored ?? DEFAULT_REPO_SETTINGS;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/__tests__/repoSettings.test.ts src/__tests__/repoSettingsStore.test.tsx && npx tsc --noEmit`
Expected: all pass, tsc clean.

- [ ] **Step 5: Checkpoint**

Run: `npm test 2>&1 | grep -E "Test Files|Tests  |^ *×"`
Expected: no failures.

---

### Task 3: Release notes honor the settings

**Files:**
- Modify: `src/lib/releaseNotes.ts`, `src/components/ReleaseNotesDialog.tsx`
- Test: `src/__tests__/releaseNotes.test.ts`, `src/__tests__/ReleaseNotesDialog.test.tsx`

**Interfaces:**
- Consumes: `compileTicketPattern`, `linkingConfigured`, `DEFAULT_REPO_SETTINGS` (Task 2); `useRepoSettings`, `useRepoSettingsStore`.
- Produces: `FormatOptions` gains `ticketPattern?: string` and `jiraBaseUrl?: string` (defaults = `DEFAULT_REPO_SETTINGS`); with `jiraLinks: true` they decide what is linked and where.

- [ ] **Step 1: Write the failing tests**

Append to the `formatReleaseNotes` describe in `src/__tests__/releaseNotes.test.ts` (before its closing `});`):

```ts
  const sub = (subject: string) => [{ oid: "a", subject, timestamp: ts("2026-10-04T12:00:00") }];

  it("uses a custom ticket pattern and Jira URL (adding a missing trailing slash)", () => {
    const out = formatReleaseNotes(sub("ABC-12 | x, relates to CEM-5"), {
      jiraLinks: true,
      dates: false,
      ticketPattern: "ABC-\\d+",
      jiraBaseUrl: "https://jira.example.com/browse",
    });
    expect(out).toBe("- [ABC-12](https://jira.example.com/browse/ABC-12) | x, relates to CEM-5");
  });

  it("links every id when the pattern uses alternation", () => {
    const out = formatReleaseNotes(sub("CEM-1 and ABC-2"), {
      jiraLinks: true,
      dates: false,
      ticketPattern: "CEM-\\d+|ABC-\\d+",
      jiraBaseUrl: "https://j.example.com/",
    });
    expect(out).toBe("- [CEM-1](https://j.example.com/CEM-1) and [ABC-2](https://j.example.com/ABC-2)");
  });

  it("links the whole id even when the pattern has capture groups", () => {
    const out = formatReleaseNotes(sub("CEM-77 | y"), {
      jiraLinks: true,
      dates: false,
      ticketPattern: "(CEM)-(\\d+)",
      jiraBaseUrl: "https://j.example.com/",
    });
    expect(out).toBe("- [CEM-77](https://j.example.com/CEM-77) | y");
  });

  it("produces plain text, not an error, for an invalid stored pattern", () => {
    const out = formatReleaseNotes(sub("CEM-1 | y"), { jiraLinks: true, dates: false, ticketPattern: "CEM-(" });
    expect(out).toBe("- CEM-1 | y");
  });

  it("produces plain text when the Jira URL is empty", () => {
    const out = formatReleaseNotes(sub("CEM-1 | y"), { jiraLinks: true, dates: false, jiraBaseUrl: "" });
    expect(out).toBe("- CEM-1 | y");
  });
```

In `src/__tests__/ReleaseNotesDialog.test.tsx`:

1. Add `invokeGetRepoSettings: vi.fn(),` to the `vi.mock("../lib/tauri", ...)` factory object.
2. Add imports: `import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";` and `import { useRepoSettingsStore } from "../store/repoSettingsStore";`.
3. In `beforeEach`, add:

```tsx
    useRepoSettingsStore.setState({ byPath: {} });
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(DEFAULT_REPO_SETTINGS);
```

4. Append inside the describe:

```tsx
  it("uses the repo's ticket pattern, so ids outside it stay plain", async () => {
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue({ ...DEFAULT_REPO_SETTINGS, ticketPattern: "ABC-\\d+" });
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    const box = await screen.findByLabelText("Release notes text");

    await waitFor(() => expect(box).toHaveProperty("value", "- CEM-1 | one (#1), 04/10"));
  });

  it("disables the Jira links checkbox when the repo has no Jira URL", async () => {
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue({ ...DEFAULT_REPO_SETTINGS, jiraBaseUrl: "" });
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);

    await waitFor(() => expect(screen.getByLabelText("Jira links")).toBeDisabled());
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/__tests__/releaseNotes.test.ts src/__tests__/ReleaseNotesDialog.test.tsx`
Expected: the new tests FAIL (custom pattern ignored; checkbox not disabled). Existing tests still pass.

- [ ] **Step 3: Implement**

In `src/lib/releaseNotes.ts`:

Add import: `import { DEFAULT_REPO_SETTINGS, compileTicketPattern } from "./repoSettings";`

Replace the `JIRA_BROWSE_URL` constant and `linkTickets` with:

```ts
function linkTickets(subject: string, ticketPattern: string, jiraBaseUrl: string): string {
  const re = compileTicketPattern(ticketPattern);
  const base = jiraBaseUrl.trim();
  if (!re || !base) return subject;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return subject.replace(re, (id) => `[${id}](${prefix}${id})`);
}
```

Extend `FormatOptions`:

```ts
export interface FormatOptions {
  dates?: boolean;
  prNumbers?: boolean;
  /** Turn ticket ids into markdown links to their Jira issue. */
  jiraLinks?: boolean;
  /** Regex source for a ticket id; defaults to the repo default. */
  ticketPattern?: string;
  jiraBaseUrl?: string;
}
```

Change the destructuring in `formatReleaseNotes` to:

```ts
  {
    dates = true,
    prNumbers = true,
    jiraLinks = false,
    ticketPattern = DEFAULT_REPO_SETTINGS.ticketPattern,
    jiraBaseUrl = DEFAULT_REPO_SETTINGS.jiraBaseUrl,
  }: FormatOptions = {}
```

and change the link line to `const subject = jiraLinks ? linkTickets(stripped, ticketPattern, jiraBaseUrl) : stripped;`

In `src/components/ReleaseNotesDialog.tsx`:

Add imports:

```tsx
import { useRepoSettings } from "../hooks/useRepoSettings";
import { linkingConfigured } from "../lib/repoSettings";
```

After the `repoPath` line add:

```tsx
  const settings = useRepoSettings(repoPath);
  const canLink = linkingConfigured(settings);
  const linking = jiraLinks && canLink;
```

Replace the `generated` memo with:

```tsx
  const generated = useMemo(
    () =>
      formatReleaseNotes(commits, {
        dates,
        prNumbers,
        jiraLinks: linking,
        ticketPattern: settings.ticketPattern,
        jiraBaseUrl: settings.jiraBaseUrl,
      }),
    [commits, dates, prNumbers, linking, settings.ticketPattern, settings.jiraBaseUrl]
  );
```

Change the "Jira links" checkbox to `checked={linking}` and add `disabled={!canLink}` and `title={canLink ? undefined : "Set a ticket pattern and Jira URL in Settings → Repository"}` on its `<input>`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/__tests__/releaseNotes.test.ts src/__tests__/ReleaseNotesDialog.test.tsx && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Checkpoint**

Run: `npm test 2>&1 | grep -E "Test Files|Tests  |^ *×"`
Expected: no failures.

---

### Task 4: Worktree folder in the dirty-checkout dialog

**Files:**
- Modify: `src/lib/dirtyCheckout.ts`, `src/components/DirtyCheckoutDialog.tsx`
- Test: `src/__tests__/dirtyCheckout.test.tsx`, `src/__tests__/DirtyCheckoutDialog.test.tsx`

**Interfaces:**
- Consumes: `useRepoSettings`, `useRepoSettingsStore` (Task 2).
- Produces: `defaultWorktreePath(repoPath: string, branchName: string, isRemote?: boolean, worktreeDir?: string): string`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/dirtyCheckout.test.tsx`, inside the `"dirty checkout helpers"` describe, after the existing `defaultWorktreePath` test add:

```tsx
  it("puts the worktree in the configured folder, without doubled slashes", () => {
    expect(defaultWorktreePath("/work/app", "feature/login", false, "/wt")).toBe("/wt/app-feature-login");
    expect(defaultWorktreePath("/work/app/", "origin/fix", true, "/wt/")).toBe("/wt/app-fix");
    expect(defaultWorktreePath("/work/app", "x", false, "")).toBe("/work/app-x");
  });
```

In `src/__tests__/DirtyCheckoutDialog.test.tsx`: add `import { useRepoSettingsStore } from "../store/repoSettingsStore";` and `import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";`. In `beforeEach` add `useRepoSettingsStore.setState({ byPath: { "/work/app": DEFAULT_REPO_SETTINGS } });` (a cached entry stops the hook calling the backend). Append inside the describe:

```tsx
  it("defaults the worktree path into the repo's configured worktree folder", () => {
    useRepoSettingsStore.setState({ byPath: { "/work/app": { ...DEFAULT_REPO_SETTINGS, worktreeDir: "/wt" } } });
    open(branch);
    expect((screen.getByLabelText("Worktree path") as HTMLInputElement).value).toBe("/wt/app-feature");
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/__tests__/dirtyCheckout.test.tsx src/__tests__/DirtyCheckoutDialog.test.tsx`
Expected: the two new tests FAIL.

- [ ] **Step 3: Implement**

In `src/lib/dirtyCheckout.ts` replace `defaultWorktreePath` with:

```ts
/** `<worktreeDir or repo parent>/<repo-name>-<branch>`, with slashes in the branch turned into dashes. */
export function defaultWorktreePath(
  repoPath: string,
  branchName: string,
  isRemote = false,
  worktreeDir = ""
): string {
  const repo = repoPath.replace(/\/+$/, "");
  const local = isRemote ? branchName.split("/").slice(1).join("/") || branchName : branchName;
  const dir = worktreeDir.trim().replace(/\/+$/, "");
  const prefix = dir ? `${dir}/${repo.split("/").pop()}` : repo;
  return `${prefix}-${local.replace(/\//g, "-")}`;
}
```

In `src/components/DirtyCheckoutDialog.tsx`: add `import { useRepoSettings } from "../hooks/useRepoSettings";`; after the `repoPath` line add `const { worktreeDir } = useRepoSettings(repoPath || null);`; change the effect's first line to `setWorktreePath(defaultWorktreePath(repoPath, target.name, target.isRemote, worktreeDir));` and its dependency array to `[target, repoPath, worktreeDir, close]`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/__tests__/dirtyCheckout.test.tsx src/__tests__/DirtyCheckoutDialog.test.tsx && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Checkpoint**

Run: `npm test 2>&1 | grep -E "Test Files|Tests  |^ *×"`
Expected: no failures.

---

### Task 5: Settings modal "Repository" section

**Files:**
- Create: `src/store/settingsModalStore.ts`, `src/components/RepoSettingsSection.tsx`
- Modify: `src/components/SettingsModal.tsx`, `src/components/Sidebar.tsx`
- Test: `src/__tests__/RepoSettingsSection.test.tsx`; re-run `SettingsModal.test.tsx`, `Sidebar.test.tsx`

**Interfaces:**
- Consumes: `useRepoSettingsStore`, `ticketPatternError`, `DEFAULT_REPO_SETTINGS` (Task 2).
- Produces:
  - `useSettingsModalStore { isOpen: boolean; repoPath: string | null; open(repoPath?: string | null): void; close(): void }`
  - `<RepoSettingsSection initialRepoPath?: string | null scrollIntoView?: boolean />`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/RepoSettingsSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeGetRepoSettings: vi.fn(),
  invokeSetRepoSettings: vi.fn(),
  invokeResetRepoSettings: vi.fn(),
}));

import * as tauri from "../lib/tauri";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSettingsModalStore } from "../store/settingsModalStore";
import RepoSettingsSection from "../components/RepoSettingsSection";

describe("settingsModalStore", () => {
  it("opens with an optional preselected repo and closes", () => {
    useSettingsModalStore.getState().open("/r");
    expect(useSettingsModalStore.getState()).toMatchObject({ isOpen: true, repoPath: "/r" });
    useSettingsModalStore.getState().close();
    expect(useSettingsModalStore.getState()).toMatchObject({ isOpen: false, repoPath: null });
    useSettingsModalStore.getState().open();
    expect(useSettingsModalStore.getState()).toMatchObject({ isOpen: true, repoPath: null });
  });
});

describe("RepoSettingsSection", () => {
  const other = { ticketPattern: "ABC-\\d+", jiraBaseUrl: "https://j.example.com/browse/", worktreeDir: "/wt" };

  beforeEach(() => {
    vi.clearAllMocks();
    useRepoSettingsStore.setState({ byPath: {} });
    useWorkspaceStore.setState({
      repos: [
        { id: 1, path: "/work/app", name: "app", pinned: false },
        { id: 2, path: "/work/other", name: "other", pinned: false },
      ],
      activeRepoId: 1,
    } as never);
    vi.mocked(tauri.invokeGetRepoSettings).mockImplementation(async (p) =>
      p === "/work/other" ? other : DEFAULT_REPO_SETTINGS
    );
    vi.mocked(tauri.invokeSetRepoSettings).mockImplementation(async (_p, s) => s);
    vi.mocked(tauri.invokeResetRepoSettings).mockResolvedValue(undefined);
  });

  it("shows the preselected repo's settings in the form", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/other" />);
    await waitFor(() => expect((screen.getByLabelText("Ticket pattern") as HTMLInputElement).value).toBe("ABC-\\d+"));
    expect((screen.getByLabelText("Repository") as HTMLSelectElement).value).toBe("/work/other");
    expect((screen.getByLabelText("Jira base URL") as HTMLInputElement).value).toBe("https://j.example.com/browse/");
    expect((screen.getByLabelText("Worktree folder") as HTMLInputElement).value).toBe("/wt");
  });

  it("falls back to the first repo when none is preselected", async () => {
    render(<RepoSettingsSection />);
    expect((screen.getByLabelText("Repository") as HTMLSelectElement).value).toBe("/work/app");
  });

  it("saves to the repo picked in the dropdown, not the active one", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/app" />);
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "/work/other" } });
    await waitFor(() => expect((screen.getByLabelText("Ticket pattern") as HTMLInputElement).value).toBe("ABC-\\d+"));

    fireEvent.change(screen.getByLabelText("Ticket pattern"), { target: { value: "XYZ-\\d+" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(tauri.invokeSetRepoSettings).toHaveBeenCalledWith("/work/other", { ...other, ticketPattern: "XYZ-\\d+" })
    );
  });

  it("shows the normalized value the backend stored after saving", async () => {
    vi.mocked(tauri.invokeSetRepoSettings).mockImplementation(async (_p, s) => ({
      ...s,
      jiraBaseUrl: s.jiraBaseUrl + "/",
    }));
    render(<RepoSettingsSection initialRepoPath="/work/app" />);
    await waitFor(() => expect(screen.getByLabelText("Jira base URL")).toHaveProperty("value", DEFAULT_REPO_SETTINGS.jiraBaseUrl));

    fireEvent.change(screen.getByLabelText("Jira base URL"), { target: { value: "https://j.example.com/browse" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByLabelText("Jira base URL")).toHaveProperty("value", "https://j.example.com/browse/"));
  });

  it("blocks saving an invalid ticket pattern and says why", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/app" />);
    await waitFor(() => expect(screen.getByLabelText("Ticket pattern")).toHaveProperty("value", "CEM-\\d+"));

    fireEvent.change(screen.getByLabelText("Ticket pattern"), { target: { value: "CEM-(" } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Invalid|Unterminated|regular expression/i)).toBeTruthy();
  });

  it("shows a backend save error inline and keeps the form", async () => {
    vi.mocked(tauri.invokeSetRepoSettings).mockRejectedValue("Jira base URL must start with http:// or https://");
    render(<RepoSettingsSection initialRepoPath="/work/app" />);
    await waitFor(() => expect(screen.getByLabelText("Jira base URL")).toHaveProperty("value", DEFAULT_REPO_SETTINGS.jiraBaseUrl));

    fireEvent.change(screen.getByLabelText("Jira base URL"), { target: { value: "ftp://x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Jira base URL must start with http:// or https://")).toBeTruthy();
    expect(screen.getByLabelText("Jira base URL")).toHaveProperty("value", "ftp://x");
  });

  it("Reset to defaults clears the stored settings and refills the form", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/other" />);
    await waitFor(() => expect(screen.getByLabelText("Ticket pattern")).toHaveProperty("value", "ABC-\\d+"));

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    await waitFor(() => expect(tauri.invokeResetRepoSettings).toHaveBeenCalledWith("/work/other"));
    await waitFor(() => expect(screen.getByLabelText("Ticket pattern")).toHaveProperty("value", DEFAULT_REPO_SETTINGS.ticketPattern));
  });

  it("asks you to add a repo when there are none", () => {
    useWorkspaceStore.setState({ repos: [], activeRepoId: null } as never);
    render(<RepoSettingsSection />);
    expect(screen.getByText(/Add a repository/i)).toBeTruthy();
    expect(screen.queryByLabelText("Ticket pattern")).toBeNull();
  });
});
```

Add to `src/__tests__/Sidebar.test.tsx` (inside its describe; it already clicks "Open settings" in an existing test at ~line 113 — keep that test passing):

```tsx
  it("opens the settings modal with a repo preselected from the settings store", async () => {
    const { useSettingsModalStore } = await import("../store/settingsModalStore");
    render(<Sidebar />);
    act(() => useSettingsModalStore.getState().open("/work/app"));
    expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
    act(() => useSettingsModalStore.getState().close());
  });
```

(add `act` to its `@testing-library/react` import if missing).

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/__tests__/RepoSettingsSection.test.tsx src/__tests__/Sidebar.test.tsx`
Expected: FAIL, cannot resolve `../store/settingsModalStore` / `../components/RepoSettingsSection`.

- [ ] **Step 3: Implement**

`src/store/settingsModalStore.ts`:

```ts
import { create } from "zustand";

// Drives the Settings modal so it can be opened from the sidebar gear or a
// repo's right-click menu, optionally with a repo preselected.
interface SettingsModalState {
  isOpen: boolean;
  repoPath: string | null;
  open: (repoPath?: string | null) => void;
  close: () => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  isOpen: false,
  repoPath: null,
  open: (repoPath = null) => set({ isOpen: true, repoPath }),
  close: () => set({ isOpen: false, repoPath: null }),
}));
```

`src/components/RepoSettingsSection.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { DEFAULT_REPO_SETTINGS, ticketPatternError, type RepoSettings } from "../lib/repoSettings";
import { toast } from "../store/toastStore";

interface Props {
  /** Repo to show first; falls back to the first repo. */
  initialRepoPath?: string | null;
  /** Scroll this section into view on mount (used when opened for a specific repo). */
  scrollIntoView?: boolean;
}

const inputClass =
  "w-full bg-elevated border border-border-subtle rounded px-2 py-1 text-xs text-text-primary outline-none";

export default function RepoSettingsSection({ initialRepoPath, scrollIntoView }: Props) {
  const repos = useWorkspaceStore((s) => s.repos);
  const [repoPath, setRepoPath] = useState(initialRepoPath ?? repos[0]?.path ?? "");
  const stored = useRepoSettingsStore((s) => (repoPath ? s.byPath[repoPath] : undefined));
  const [form, setForm] = useState<RepoSettings>(DEFAULT_REPO_SETTINGS);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollIntoView) rootRef.current?.scrollIntoView?.({ block: "start" });
  }, [scrollIntoView]);

  useEffect(() => {
    if (repoPath) void useRepoSettingsStore.getState().load(repoPath);
  }, [repoPath]);

  // Refill the form whenever a different repo is picked or its stored settings arrive/change.
  useEffect(() => {
    if (stored) setForm(stored);
    setSaveError(null);
  }, [repoPath, stored]);

  if (repos.length === 0) {
    return (
      <div>
        <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Repository</div>
        <div className="text-xs text-text-muted">Add a repository to configure it.</div>
      </div>
    );
  }

  const patternError = ticketPatternError(form.ticketPattern);
  const set = (patch: Partial<RepoSettings>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (busy || patternError || !repoPath) return;
    setBusy(true);
    setSaveError(null);
    try {
      const storedValue = await useRepoSettingsStore.getState().save(repoPath, form);
      setForm(storedValue);
      toast.success("Saved repo settings");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy || !repoPath) return;
    setBusy(true);
    setSaveError(null);
    try {
      await useRepoSettingsStore.getState().reset(repoPath);
      setForm(DEFAULT_REPO_SETTINGS);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wide text-text-muted">Repository</div>
      <select
        aria-label="Repository"
        value={repoPath}
        onChange={(e) => setRepoPath(e.target.value)}
        className={inputClass}
      >
        {repos.map((r) => (
          <option key={r.id} value={r.path}>
            {r.name}
          </option>
        ))}
      </select>

      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Ticket pattern (regex)
        <input
          aria-label="Ticket pattern"
          value={form.ticketPattern}
          onChange={(e) => set({ ticketPattern: e.target.value })}
          placeholder="CEM-\d+"
          className={`${inputClass} font-mono`}
        />
        {patternError && <span className="text-danger">{patternError}</span>}
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Jira base URL
        <input
          aria-label="Jira base URL"
          value={form.jiraBaseUrl}
          onChange={(e) => set({ jiraBaseUrl: e.target.value })}
          placeholder="https://your-org.atlassian.net/browse/"
          className={`${inputClass} font-mono`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Worktree folder (absolute path; empty = next to the repo)
        <input
          aria-label="Worktree folder"
          value={form.worktreeDir}
          onChange={(e) => set({ worktreeDir: e.target.value })}
          className={`${inputClass} font-mono`}
        />
      </label>
      <div className="text-xs text-text-muted">Clear the pattern or the URL to turn Jira links off for this repo.</div>
      {saveError && <div className="text-xs text-danger break-words">{saveError}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          className="px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover disabled:opacity-50"
          onClick={() => void reset()}
        >
          Reset to defaults
        </button>
        <button
          type="button"
          disabled={busy || !!patternError}
          className="px-3 py-1 text-xs rounded bg-accent text-accent-contrast disabled:opacity-50"
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </div>
  );
}
```

In `src/components/SettingsModal.tsx`: add imports

```tsx
import RepoSettingsSection from "./RepoSettingsSection";
import { useSettingsModalStore } from "../store/settingsModalStore";
```

Inside the component, after the `activeRepoPath` line add `const requestedRepoPath = useSettingsModalStore((s) => s.repoPath);`. After the closing `</div>` of the "CI" block (the last block before the modal's final two `</div>`s) add:

```tsx
        <RepoSettingsSection
          initialRepoPath={requestedRepoPath ?? activeRepoPath}
          scrollIntoView={!!requestedRepoPath}
        />
```

In `src/components/Sidebar.tsx`: add `import { useSettingsModalStore } from "../store/settingsModalStore";`; remove `useState` import if now unused; replace `const [isSettingsOpen, setIsSettingsOpen] = useState(false);` with:

```tsx
  const isSettingsOpen = useSettingsModalStore((s) => s.isOpen);
  const openSettings = useSettingsModalStore((s) => s.open);
  const closeSettings = useSettingsModalStore((s) => s.close);
```

then `onClick={() => setIsSettingsOpen(true)}` → `onClick={() => openSettings()}` and `{isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}` → `{isSettingsOpen && <SettingsModal onClose={closeSettings} />}`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/__tests__/RepoSettingsSection.test.tsx src/__tests__/Sidebar.test.tsx src/__tests__/SettingsModal.test.tsx && npx tsc --noEmit`
Expected: all pass. If `SettingsModal.test.tsx` fails because its `vi.mock("../lib/tauri", () => ({ invokeWriteSettings }))` factory has no `invokeGetRepoSettings`, add `invokeGetRepoSettings`, `invokeSetRepoSettings` and `invokeResetRepoSettings` as `vi.fn()` entries to that factory (the section only calls them when a repo exists; add a resolved default for `invokeGetRepoSettings` if a test needs it).

- [ ] **Step 5: Checkpoint**

Run: `npm test 2>&1 | grep -E "Test Files|Tests  |^ *×"`
Expected: no failures.

---

### Task 6: "Repo settings…" in the repo list, then full verification

**Files:**
- Modify: `src/components/RepoList.tsx`
- Test: `src/__tests__/RepoList.test.tsx`

**Interfaces:**
- Consumes: `useSettingsModalStore.open(repoPath)` (Task 5); `useContextMenu` from `./ContextMenu` (returns `{ openMenu, menu }`).

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/RepoList.test.tsx` inside its describe (match the file's existing setup for repos; it uses `useWorkspaceStore.setState({ repos: [...] })`), plus `import { useSettingsModalStore } from "../store/settingsModalStore";` and `fireEvent`, `screen` if missing:

```tsx
  it("right-click → Repo settings… opens settings for that repo", () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/work/app", name: "app", pinned: false }],
      activeRepoId: 1,
      loadRepos: vi.fn().mockResolvedValue(undefined),
    } as never);
    useSettingsModalStore.getState().close();
    render(<RepoList />);

    fireEvent.contextMenu(screen.getByText("app"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Repo settings…" }));

    expect(useSettingsModalStore.getState()).toMatchObject({ isOpen: true, repoPath: "/work/app" });
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/__tests__/RepoList.test.tsx`
Expected: FAIL — no menu item "Repo settings…".

- [ ] **Step 3: Implement**

In `src/components/RepoList.tsx` add imports:

```tsx
import { useContextMenu } from "./ContextMenu";
import { useSettingsModalStore } from "../store/settingsModalStore";
```

Inside the component after `showRecent` state add `const { openMenu, menu } = useContextMenu();`. On the repo-row wrapper `<div key={r.id} className="flex items-center group">` add:

```tsx
          onContextMenu={(e) =>
            openMenu(e, [{ label: "Repo settings…", onSelect: () => useSettingsModalStore.getState().open(r.path) }])
          }
```

and render `{menu}` as the last child of the component's root `<div className="flex flex-col gap-1 p-2">`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/__tests__/RepoList.test.tsx && npx tsc --noEmit`
Expected: pass, tsc clean.

- [ ] **Step 5: Final verification**

Run:
```
cd src-tauri && cargo test 2>&1 | grep -E "test result|FAILED"; cd .. && npx tsc --noEmit && npm test 2>&1 | grep -E "Test Files|Tests  |^ *×|Errors "
```
Expected: Rust `0 failed`; tsc clean; Vitest all passing, with only the pre-existing Toolbar unhandled error (if it still appears). Then manually confirm in the running app: right-click a repo → "Repo settings…" opens Settings scrolled to "Repository"; change the pattern to something else, Save, open Release notes and see the links follow it; clear the Jira URL and see "Jira links" disabled.
