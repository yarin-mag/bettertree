# Per-repo settings (P1) — design

Date: 2026-10-06
Status: draft for review

## Purpose

Bettertree hardcodes things that differ per repository: the Jira ticket prefix
(`CEM-`) and Jira URL in release notes, and where new worktrees are created.
Add a small per-repo settings store so these can be changed per repository.
This is the foundation for the release toolkit (P2), which will add more fields.

Success: a user can change the ticket pattern, Jira base URL and worktree folder
for a repo, the release-notes dialog and dirty-checkout dialog honor them, and a
repo with no stored settings behaves exactly as it does today.

## Scope

In: three fields, storage, Rust commands, frontend store/hook, wiring into two
existing features, two editing entry points.

Out (explicitly): release-tag pattern (added in P2), import/export of settings,
team-shared settings files, per-branch settings.

## Fields and defaults

| Field | Meaning | Default |
|---|---|---|
| `ticketPattern` | Regex (JS syntax, no delimiters/flags) matching a ticket id | `CEM-\d+` |
| `jiraBaseUrl` | URL prefix a ticket id is appended to | `https://cemento.atlassian.net/browse/` |
| `worktreeDir` | Folder new worktrees are created in; empty = next to the repo | `` (empty) |

Defaults equal today's hardcoded behavior. Clearing `ticketPattern` or
`jiraBaseUrl` disables Jira linking for that repo.

## Storage (Rust)

Settings are keyed by repo **path**, not repo id: re-adding a repo (for example
from "recently closed") creates a new id, and settings must survive that.

```sql
CREATE TABLE IF NOT EXISTS repo_settings (
  path          TEXT PRIMARY KEY,
  ticket_pattern TEXT NOT NULL,
  jira_base_url  TEXT NOT NULL,
  worktree_dir   TEXT NOT NULL
)
```

Created in `init_db`. No row means defaults; there is no migration.

Commands (registered in `lib.rs`, wrapped in `tauri.ts`):

- `get_repo_settings(repo_path) -> RepoSettings` — stored row or defaults.
- `set_repo_settings(repo_path, settings) -> RepoSettings` — validates, upserts.
- `reset_repo_settings(repo_path)` — deletes the row.

`RepoSettings` serializes camelCase: `{ ticketPattern, jiraBaseUrl, worktreeDir }`.

Validation in Rust (`AppError::Operation` with a readable message):

- `jiraBaseUrl` is empty or starts with `http://` / `https://`; a missing
  trailing `/` is added.
- `ticketPattern` may be empty (linking off). Regex validity is checked by the
  frontend, which uses JS regex syntax; Rust does not compile it.
- `worktreeDir` is empty or an absolute path.

## Frontend

- `src/store/repoSettingsStore.ts`: cache `Record<path, RepoSettings>`, `load(path)`,
  `save(path, settings)`, `reset(path)`. Exposes `DEFAULT_REPO_SETTINGS`.
- `useRepoSettings(path)` hook: loads on mount/path change, returns cached
  values or defaults while loading.
- `formatReleaseNotes` options gain `ticketPattern` and `jiraBaseUrl`
  (replacing the hardcoded constants). The ticket regex is built as
  `\b(?:<pattern>)\b`, global. If the pattern fails to compile, or either field
  is empty, no links are produced.
- `ReleaseNotesDialog` reads the active repo's settings and passes them in; the
  "Jira links" checkbox stays and defaults on only when linking is configured.
- `DirtyCheckoutDialog` / `defaultWorktreePath` use `worktreeDir` when set:
  `<worktreeDir>/<repo-name>-<branch>`.

## Editing

1. **Settings modal**: new "Repository" section with a repo picker (defaults to
   the active repo), the three fields, Save, and "Reset to defaults".
2. **Repo list**: right-click a repo -> "Repo settings…" opens the same section
   with that repo preselected.

Form validation (before saving): `ticketPattern` must compile with
`new RegExp`; messages are shown inline. Save errors from Rust are shown inline.

## Error handling

- Load failure: fall back to defaults and show a toast once.
- Invalid stored regex (edited outside the app): linking off, no crash.
- Save failure: stay in the form, show the message.

## Testing

Rust (`db.rs`/new module tests, in-memory SQLite): defaults when no row, round
trip, upsert overwrites, reset deletes, URL normalization and rejection, relative
`worktreeDir` rejected, settings survive `remove_repo` + `add_repo` of the same path.

Vitest: store load/save/reset and default fallback; formatter with a custom
pattern and URL, with empty values, and with an invalid pattern; settings form
validation and Save/Reset; both entry points open the section with the right
repo; dirty-checkout default path honors `worktreeDir`.

## Open questions

None.
