# Bettertree — Design Spec

Date: 2026-07-06

## Purpose

A modern, faster, more powerful SourceTree alternative: a desktop git GUI client for browsing multi-repo workspaces, visualizing commit graphs/branches, and searching across branches/commits/history with richer metadata display than existing tools.

## Tech Stack

- **Shell**: Tauri (Rust backend + system webview) — chosen over Electron for smaller binary size, lower RAM, and native-speed git operations.
- **Git backend**: `git2` (libgit2 Rust bindings) — structured data, no CLI text parsing, no dependency on the user's installed git version.
- **Frontend**: React + TypeScript.
- **State management**: Zustand.
- **Styling**: Tailwind CSS + shadcn/ui, with dark/light theme support.
- **Local storage**: SQLite (via `rusqlite`) for the workspace repo registry and per-repo full-text search index (FTS5).
- **Commit graph rendering**: custom SVG/Canvas renderer, virtualized (only visible rows drawn), built in-house rather than an existing gitgraph library, for performance and full styling control on large histories.
- **Auth**: delegates to the system git credential helper and SSH agent — no in-app credential storage.
- **Target platforms**: macOS, Windows, Linux (cross-platform from day one).

## Scope (v1)

All four are in scope for v1, spec'd together (not phased into separate specs, per user decision):

1. Multi-repo workspace (sidebar list of tracked repos, switch between them).
2. Commit graph + branch view (visual DAG, click commit for detail).
3. Search & filter:
   - Branch/tag names — in-memory fuzzy match, no index.
   - Commit messages — full-text search via SQLite FTS5.
   - Commit content (diffs, like `git log -S/-G`) — indexed via the same FTS5 store, built in the background per repo.
   - Author/date/path filters layered on top of any of the above.
4. Working-copy workflow: stage/unstage hunks, commit, push, pull, fetch.
5. Rich metadata panels: commit author/date/message, diff stats, changed file tree, unified/side-by-side diff toggle.

## UI Layout

Chosen via visual mockup review (Option B — "full-width graph + drawer"):

- **Top**: search bar (branches/tags/commits) spanning the window.
- **Left sidebar**: workspace repo list (add/switch/pin), and for the active repo — branches, tags, remotes tree.
- **Center**: commit graph, full width for maximum lane visibility on busy histories.
- **Bottom drawer**: slides up on commit selection — metadata (author, date, message, diff stat) and diff viewer (unified/side-by-side toggle). Collapses when not needed, so the graph reclaims full vertical space.

## Architecture

### Backend (Rust / Tauri)

- **Workspace manager**: SQLite table of tracked repo paths + metadata (last opened, pinned order). Sidebar reads/writes through Tauri commands. A tracked path that no longer exists on disk is shown greyed out in the sidebar with a "path not found, remove?" affordance instead of crashing.
- **Repo reader**: git2 wrapper module — branches (local + remote), tags, commit walk (graph topology + lane data), working-copy status, diffs. Pure read functions with no UI knowledge, independently testable against fixture repos.
- **Commit graph engine**: computes lane assignments per commit once per repo-open/fetch; sends a flat array to the frontend. Recomputes incrementally on fetch (only new commits) rather than rebuilding from scratch.
- **Search index**: SQLite FTS5 table, one row per commit (hash, message, author, date, diff text), scoped per repo. Built asynchronously in the background on repo open, updated incrementally on fetch (new commits only). If index build fails, search falls back to a live git2 walk for that repo and logs a warning — it does not block other features.
- **Working-copy ops**: stage/unstage hunks, commit, push, pull, fetch — thin git2 write-op wrappers. Falls back to shelling the system `git` CLI only where git2 lacks parity (e.g., specific credential-helper flows), if such a gap is found during implementation.
- **Error surface**: git operation failures (auth failure, merge conflict, network error, push rejection) are returned as typed Rust error variants, translated into actionable frontend messages (e.g., "push rejected: pull first") rather than raw error strings.

### Frontend (React/TS)

- **Commit graph renderer**: custom SVG/Canvas, virtualized rendering for large histories, receives precomputed lane data from the backend.
- **Diff viewer**: single shared component supporting unified and side-by-side modes, reused for both working-copy diffs and historical commit diffs.
- **Search UI**: single search bar; branch/tag results resolve client-side (in-memory fuzzy match); commit message/content/author/date results round-trip to the backend FTS5 query and return matching commit hashes + snippets, which the frontend uses to highlight/jump within the graph.

## Data Flow

1. **Open repo** → git2 reads refs/commits → branch list + initial commit-graph page sent to frontend → async FTS5 index build kicked off in the background.
2. **Fetch** → git2 fetch → refreshed branch list + new commits appended to graph → incremental index update (new commits only, not a full rebuild).
3. **Branch/tag search** → resolved entirely client-side against the in-memory branch/tag list.
4. **Commit message/content search** → frontend query → backend FTS5 lookup → matching hashes + snippets returned → frontend highlights/jumps in the graph.
5. **Select commit** → frontend requests full diff for that commit → backend computes via git2 → drawer slides up with metadata + diff.
6. **Stage/commit/push/pull** → frontend action → backend git2 write op → on success, affected views (status, graph, branch list) are refreshed.

## Error Handling

- Git operation failures surface as typed errors from the backend, shown as toasts or inline messages with actionable next steps.
- Missing/corrupt tracked repo paths are shown greyed out in the sidebar rather than crashing the app.
- Search index failures degrade gracefully to a live (unindexed) git2 walk per repo, without affecting other repos or features.

## Testing Policy (cross-phase)

Applies to every implementation phase, not just a final pass:

- Each phase includes both **unit tests** (Rust git2 wrapper functions against fixture repos — merges, orphan branches, large histories; frontend component tests for the graph renderer's lane assignment and the diff viewer's two render modes) and **end-to-end tests** (Tauri webdriver or Playwright against the built app, covering that phase's user-facing flows).
- Before a phase is considered done, the **full existing test suite** (unit + e2e, all prior phases included) is run to confirm no regressions — not just the new phase's own tests.
- Fixture repos (bare repos with known histories) are checked into the test suite and reused across phases rather than recreated per phase.

## Out of Scope (v1)

- Blame view, submodule management, interactive rebase UI, merge/conflict resolution UI beyond surfacing the error — these are natural follow-ups but not required for the v1 scope defined above.
- In-app credential storage (explicitly delegated to system git credential helper / SSH agent instead).
