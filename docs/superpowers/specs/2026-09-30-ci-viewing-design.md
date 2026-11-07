# CI Viewing — Design

Date: 2026-09-30
Status: draft, awaiting review

## Goal

See CI state without leaving the app: glanceable status on commits, branches and PRs; a detailed checks list per commit; failure logs in-app; re-run and cancel. The user can give each workflow their own display name and star favorites, with a favorites-only view.

## Scope

In v1:
1. Status badges (commit rows, sidebar branches, PR list).
2. Checks panel per commit (and in PR detail).
3. In-app log viewer for jobs.
4. Actions: re-run failed jobs, re-run all, cancel.
5. Per-workflow custom name and favorite star, per repo, with a favorites-only filter.

Out of scope for v1: CI providers other than GitHub (Actions and other GitHub checks/statuses via `gh` only), live log streaming, desktop notifications, editing workflows, names/favorites for individual jobs.

## Decisions made

- Custom names and favorites attach to **workflows** (not individual jobs).
- Data comes via batched GraphQL for badges and REST + `gh run` for detail (chosen over one REST call per commit, which would hit rate limits on a 200-row list, and over branch-only badges, which give no per-commit signal).
- **Assumed, not confirmed by the user:** when favorites-only is on, the row/branch badge reflects only favorite workflows (tooltip says "favorites only"). Reversible by a single setting flag; default follows favorites.
- Names and favorites are stored locally (`localStorage`), per repo, never written to GitHub.

## Backend (`src-tauri/src/ci.rs`)

Uses the existing `GhRunner` trait so everything is unit-testable with a fake runner. Owner/repo come from `github::resolve_owner_repo`. All commands are async via `run_blocking`, registered in `lib.rs`, wrapped in `src/lib/tauri.ts`.

Types (serde camelCase):

- `CiState`: `"success" | "pending" | "failure" | "none"`.
- `CommitCi { oid, state, total, failed, pending }`.
- `WorkflowRun { runId, workflowId, workflowName, status, conclusion, url, startedAt, completedAt, headSha, jobs: Job[] }`.
- `Job { jobId, name, status, conclusion, startedAt, completedAt, url, steps: Step[] }`; `Step { number, name, status, conclusion }`.
- `OtherCheck { name, state, url, source }` for non-Actions check runs and commit statuses.
- `CommitChecks { oid, runs: WorkflowRun[], other: OtherCheck[] }`.
- `JobLog { text, truncated, failedStepNumber }`.

Commands:

| Command | Implementation |
|---|---|
| `ci_status_for_commits(repoPath, oids)` | One `gh api graphql` call with an alias per oid (chunks of ≤100) reading `statusCheckRollup`; state derived with the existing rollup logic (extracted for reuse). Returns per-workflow counts too (`byWorkflow: {workflowId → state}`) so the UI can compute the favorites-only badge without a second call. |
| `ci_commit_checks(repoPath, oid)` | `repos/{o}/{r}/actions/runs?head_sha=` then `actions/runs/{id}/jobs` per run; plus `commits/{sha}/check-runs` and `commits/{sha}/status` for "other" checks (deduped against Actions check runs). |
| `ci_job_log(repoPath, jobId, full)` | `gh run view --job <id> --log`; tail-capped at 2 MB unless `full`; locates first failed step from the job's steps. |
| `ci_rerun(repoPath, runId, failedOnly)` | `gh run rerun <id> [--failed]`. |
| `ci_cancel(repoPath, runId)` | `gh run cancel <id>`. |

Errors reuse `AppError::Operation`. The frontend maps `gh` messages to categories: not installed, not authenticated, rate-limited (with reset time when present), permission denied, other.

## Frontend

### Stores

- `ciStatusStore`: `byOid: Record<oid, CommitCi>`, `request(oids)` (debounced ~300 ms, batches unknown oids, in-flight de-dup), polling of `pending` oids every 30 s while the window is visible, backoff on errors (reuse `nextFetchDelay`). Settled (`success`/`failure`) results are never re-fetched except via explicit refresh (after re-run/cancel or manual Refresh).
- `ciChecksStore`: `CommitChecks` for the open commit, load/refresh, loading and error state, polling every 15 s while any run is in progress and the panel is open.
- `ciPrefsStore` (`localStorage`, try/catch, same pattern as `prOpenPreferenceStore`): per repo `{ names: {workflowId → string}, favorites: string[], favoritesOnly: boolean, badgeFollowsFavorites: boolean }`.

### Badges

`CiBadge` component (icon + tooltip, click opens checks panel): green check, red cross, amber spinner, none. Used in `CommitGraphRow` (between ref badges and summary), `BranchTree` rows (from branch tip oid), and `PullRequestsScreen` (replacing `checkStatusBadge` so visuals match). Visible rows report oids via a hook on the virtual list's visible range. Tooltip: "2 of 5 failed" (+ "favorites only" when applicable).

### Checks panel

New "Checks" tab in the commit drawer and modal (`CommitDrawer`) and in PR detail. One card per workflow (failures first, then running, then success): status, duration, relative time, link to GitHub, star, pencil (rename), actions. Expanding a card lists jobs with duration bars and steps. Custom name is shown as the title with the original name muted below. Last group: "Other checks". Top bar: favorites-only toggle; non-favorites collapse into "N hidden". Panel header has Refresh.

### Log viewer

Modal (portal, Esc closes). Steps as collapsible sections, failed ones open, scrolled to the first failed step. Virtualized lines (reuse `useVirtualList`), line numbers, ANSI color rendering, search with highlighted matches and next/prev, copy. Logs over the cap show the tail and a "Load full log" button. Running jobs get a manual Refresh.

### Actions

Per workflow card: "Re-run failed jobs" and "Re-run all" (finished runs), "Cancel" (running, with inline confirm). Each shows a toast, then immediately re-polls that commit's status and checks. Errors are toasted with the `gh` message.

### Empty / error states

Uses `EmptyState`: no CI on this commit; `gh` unavailable (reuses `describeGithubUnavailable`); rate-limited (shows retry time); load failure with Retry. Badges fail silently to "none" with no toast spam (one error toast per failure streak, like auto-fetch).

### Shortcuts

`c` opens the Checks tab for the selected commit; `f` toggles favorites-only while the panel has focus. Both registered via `useShortcut` so they appear in the shortcuts dialog.

## Data flow

visible rows → `ciStatusStore.request` → `ci_status_for_commits` (batched) → badges. Badge/row click or `c` → `ciChecksStore.load(oid)` → `ci_commit_checks` → panel. Job click → `ci_job_log` → viewer. Action → `ci_rerun`/`ci_cancel` → toast → re-poll.

## Testing

- Rust: fake-runner unit tests for each command's parsing (GraphQL aliases and chunking, runs+jobs assembly, other-check dedup, log truncation and failed-step location, rerun/cancel argument construction, error categorization).
- Frontend: store tests (debounce/batching, pending-only polling, prefs persistence per repo), component tests (badge states, checks panel grouping/sorting, favorites-only filter and badge follow, rename, log viewer search and failed-step jump, action flows with mocked invoke), shortcut registration.
- Manual (needs the real app and a GitHub repo with Actions): badge polling feel on a large repo, real log sizes, rate-limit behavior, rerun/cancel permissions.

## Risks

- GraphQL `statusCheckRollup` may not expose the workflow id for every context; fallback is grouping by check-suite/app and showing the favorites-only badge only for Actions workflows. Verify against a real repo early.
- Rate limits on very active repos; mitigated by batching, settled-result caching and pending-only polling.
- `gh run view --log` can be slow for large runs; run in `run_blocking` with a loading state and the tail cap.

## Open question

Badge behavior under favorites-only (assumed: follows favorites). Confirm or reverse.
