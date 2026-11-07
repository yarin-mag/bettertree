# Nest UI Redesign — v2 Layout + GitHub-Familiar Skin

Date: 2026-07-22

## Purpose

Bettertree's current UI (shipped in the 2026-07-06 visual design pass) is functional but plain: four stacked chrome rows (title bar, global search, toolbar, PR filter bar), a dropdown-only PR state filter, and a theme toggle competing for space in the main toolbar. This spec replaces it with a fresher layout and a new "Nest" skin, both validated via an interactive HTML mockup (three directions — Aerial/spacious, Forge/dense, Nest/GitHub-familiar — reviewed side by side, then a structural v2 pass applied on top of the chosen direction). **Nest** was selected; the v2 layout restructure was approved afterward. This spec covers both together, since the layout changes apply regardless of skin.

## Aesthetic Direction

Reference point: GitHub's own PR/issue list — avatars, colored label pills, status badges with a leading dot — since Bettertree's PR data already mirrors GitHub's model and the qualifier search bar already mimics GitHub's `is:open author:...` syntax. Familiarity over novelty: a user who's used GitHub should recognize the PR list instantly.

Typography: humanist system sans (`-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`) for UI text; monospace (`ui-monospace, "SF Mono", Menlo, monospace`) reserved for commit hashes, branch refs inside PR meta lines, and the qualifier search input. `font-variant-numeric: tabular-nums` on PR/commit counts.

## Design Tokens

Defined as CSS custom properties, switched by `data-theme="dark"` / `data-theme="light"` (same mechanism as today — no change to the switching architecture, only the values and their consumers).

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg-canvas` | `#0d1117` | `#ffffff` | App root background |
| `--bg-surface` | `#161b22` | `#f6f8fa` | Header, sidebar, PR/repo toolbars |
| `--bg-elevated` | `#1c232c` | `#eef1f4` | Inputs, chips, segmented control track |
| `--bg-hover` | `#1c2733` | `#eaeef2` | Hovered rows |
| `--border-subtle` | `#30363d` | `#d0d7de` | All hairline borders |
| `--text-primary` | `#e6edf3` | `#1f2328` | Primary text |
| `--text-muted` | `#8b949e` | `#59636e` | Secondary text (meta lines, section labels) |
| `--accent` | `#3fb96a` | `#1a7f37` | Primary buttons, active nav tab, active branch, focus rings |
| `--accent-contrast` | `#04170c` | `#ffffff` | Text/icon on top of `--accent` |
| `--accent-soft-bg` | `rgba(63,185,106,0.15)` | `rgba(26,127,55,0.10)` | Active branch/repo row background |
| `--success` | `#3fb950` | `#1a7f37` | Open-state badge |
| `--danger` | `#f85149` | `#cf222e` | Closed-state badge |
| `--merged` | `#a371f7` | `#8250df` | Merged-state badge (new token — today's tokens have no distinct "merged" color; PR rows previously showed state as plain text) |
| `--warn` | `#d29922` | `#9a6700` | Reserved for future use (e.g. conflict/stale indicators); not consumed by this pass |

Label pills use a per-label hue derived from a deterministic string hash (`hueFromString(label)` in the mockup), not a fixed palette — labels are user/repo-defined text, so a fixed set of named colors can't cover them. Avatars use the same hash technique keyed on author handle. Both render as `hsl(hue, …)` with theme-appropriate lightness so any label/author gets a stable, legible color in both themes.

**Migration note**: this replaces the 2026-07-06 violet accent (`#7c6ff0` / `#6555e0`) with green, and introduces `--merged` as a new token. Every existing component currently referencing `accent`/`accent-soft`/`success`/`danger` via Tailwind's semantic classes (`tailwind.config.js`) keeps working unchanged — only the CSS variable *values* change, plus one new `merged` color needs adding to `tailwind.config.js`'s `theme.extend.colors`.

## Layout Restructure (applies regardless of skin)

Today: `SearchBar` (global) → `Toolbar` (view tabs + fetch/pull + theme toggle) → body (`Sidebar` + content), four rows of chrome before any content is visible, and the PR filter bar duplicates a second search input directly under the always-visible global search bar.

New:

1. **One consolidated header** (replaces `Toolbar`'s current row): active repo name on the left, PR count + a grouped Fetch/Pull button pair on the right. No view tabs, no theme toggle here. (The mockup showed a fictional `org/repo` breadcrumb; the real data model — `RepoEntry` in `src/lib/tauri.ts` — has no "org" field, only `name`/`path`, so the real header shows `activeRepo.name` alone.)
2. **Sidebar gains three zones** (top to bottom, replacing the current flat `RepoList` → `BranchTree` stack):
   - **Nav** (new, top): the Repo/Pull Requests view switcher, moved here from `Toolbar`. It's "which mode is the whole app in," which belongs beside "which repo," not in a content-adjacent action bar.
   - **Scroll body** (existing): `RepoList` then `BranchTree`, unchanged internally.
   - **Footer** (new, bottom): active repo's filesystem path (truncated) + the theme toggle, moved here from `Toolbar`. Matches the "settings/identity corner" convention (bottom-left) used by GitHub Desktop, VS Code, Slack.
3. **Global search becomes scoped to the Repo view**: rendered above the content router (where `SearchBar` lives today), gated on `activeView !== "pulls"` rather than unconditional. It stays visible for *both* the commit-graph sub-view and the search-results-pane sub-view — `isSearchActive` only swaps which panel renders below it, it doesn't change what query the bar itself is editing, so hiding the bar there would strand the user mid-search with no way to edit the query. It disappears only for the Pull Requests view, since branches/tags/commits concepts don't apply to the PR list. The PR view keeps its own qualifier input; the two searches are no longer stacked on top of each other.
4. **PR state filter becomes a segmented control** (Open/Closed/Merged/Draft/All) instead of a `<select>`, sitting above the existing chip row (author/label/sort + "+ Filter" menu, unchanged). State is the filter every user touches first and most often — it earns a one-click segmented control instead of a dropdown.

Net chrome reduction: 4 stacked bars → 2 (header + view-scoped toolbar), with the view switcher and theme toggle relocated into the sidebar rather than removed.

## Component Mapping

- **`src/index.css`**: replace the `:root[data-theme="dark"/"light"]` token blocks with the Nest values above; add `--merged`.
- **`tailwind.config.js`**: add `merged: "var(--merged)"` to `theme.extend.colors`.
- **`Toolbar.tsx`**: strip down to the consolidated header — active repo name (`activeRepo.name`), PR count pill (PR-view-only, reads `pullRequests.length` from `useGithubStore`), Fetch/Pull button group. View-tab buttons and `ThemeToggle` are removed from here (moved to `Sidebar.tsx`, see below) but the underlying `useViewStore().setActiveView` calls and `run(invokeFetchRemote…)`/`run(invokePullRemote…)` logic are unchanged — this is a render/composition change, not a data-flow change.
- **`Sidebar.tsx`**: add a nav row at the top rendering the view-tab buttons (markup/logic moved from `Toolbar.tsx`, same `useViewStore` wiring), and a footer row at the bottom rendering the active repo path + `ThemeToggle` (moved from `Toolbar.tsx`, same `useThemeStore`/toggle wiring). `RepoList` and `BranchTree` stay in the existing scrollable middle zone, unchanged.
- **`SearchBar.tsx`**: unchanged internally.
- **`App.tsx`**: remove the top-level, unconditional `<SearchBar />` line; render it immediately above the existing content-router `<div>` (the one that switches between `PullRequestsScreen`/`SearchResultsPane`/`CommitGraph`), gated on `{activeView !== "pulls" && <SearchBar />}`. This keeps it visible for both the commit-graph and search-results sub-views, hidden only for Pull Requests.
- **`PullRequestsScreen.tsx`**: replace the `state` `<select>` (`STATE_OPTIONS`) with a segmented button group (same four+"any" values: `""`/`closed`/`merged`/`draft`/`all` — note today's `STATE_OPTIONS` has no explicit `draft` entry; the mockup adds one, so `handleStateChange` gains a `draft` branch: `setQualifier("state", null); setQualifier("is", "draft")`, and `getStateValue` recognizes `is:draft` the same way it recognizes `is:closed`/`is:merged`). PR rows gain a `--merged`-colored badge variant (today's row rendering has no visual state badge at all, just the plain-text `· {pr.state}` in the meta line — this pass adds a `Badge` treatment: open/closed/merged/draft, dot + label, using `success`/`danger`/`merged`/muted respectively) and per-label colored pills (today: plain comma-joined text) plus an author avatar (today: author is plain text in the meta line only).
- **`CommitGraphRow.tsx`**: no structural change; token values shift (violet → green accent) but component logic is untouched.
- **`ThemeToggle.tsx`**: unchanged component; only its mount location moves (`Toolbar.tsx` → `Sidebar.tsx` footer).

## Testing

Confirmed by direct read of `src/__tests__/*` before writing the implementation plan:

- **`Toolbar.test.tsx`**: renders `<Toolbar />` standalone and asserts the "Pull Requests"/"Repo" tab buttons exist and switch `useViewStore` (lines 37–44) — these two cases move to `Sidebar.test.tsx` (same `useViewStore` assertions, rendered via `<Sidebar />` instead). The "Fetch"/"Pull" button assertions (lines 52, 66) stay in `Toolbar.test.tsx` unchanged, since those buttons stay in the header. (Line 52's "Push" button assertion pre-exists against a button that's already commented out in current `Toolbar.tsx` source — a pre-existing mismatch, not something this pass introduces or is responsible for fixing.)
- **`Sidebar.test.tsx`**: currently mocks `RepoList`/`BranchTree` only; gains the two relocated Toolbar test cases (view-tab switching) plus a `ThemeToggle` mount check. `ThemeToggle` itself needs no test changes (`ThemeToggle.test.tsx` renders it standalone, insulated from where it's mounted).
- **`PullRequestsScreen.test.tsx`**: the state-filter block is a real rewrite, not a relocation. Current tests drive state via `fireEvent.change(screen.getByLabelText("State"), { target: { value: ... } })` and assert `toHaveValue(...)` (lines 166, 223, 229, 236, 243–244, 251–252) — both patterns require a native form element and don't apply to a button group. Replace with: `fireEvent.click(screen.getByRole("button", { name: "Closed" }))` (etc.) for interaction, and assert the active segment via `getByRole("button", { name: "Closed" })` having `aria-pressed="true"` (component must set `aria-pressed` per segment) instead of `toHaveValue`. `getByLabelText("Sort")` (line 156) is untouched — Sort stays a `<select>`. All other `getByLabelText`/`getByTestId("pr-row-detail")`/`getByRole("button", { name: /Filters/ })` selectors in this file are unaffected.
- **`App.test.tsx`**: mocks every child as an opaque stub and doesn't assert `search-bar`'s testid presence/absence in any of the view-switch test cases — the corrected conditional (`activeView !== "pulls"`) doesn't break anything here, but also isn't guarded by an existing test. Optional (not required to ship this pass): add a case asserting `search-bar` is absent when `activeView === "pulls"`.
- **`BranchTree.tsx`/`BranchTree.test.tsx`**: no structural change planned (token-only), so the `[data-head]`-wrapping-a-`<span>` convention `BranchTree.test.tsx` depends on (lines 49, 157) must be left exactly as-is.
- No `data-testid` or button/label text this spec relies on is being removed — `"+ Add repo"`, `"Fetch"`, `"Pull"`, PR row `data-testid="pr-row-detail"`, filter chip labels, and qualifier placeholders (`"is:open author:…"`, `"Search branches, tags, commits…"`) all carry over unchanged.
- Full regression (`cargo test` + `npm test` + `npm run e2e`) runs at the end, per established policy.

## Out of Scope

- Any change to backend behavior, IPC commands, or store data shapes (`githubStore`, `workspaceStore`, etc.) — this is a render-layer restyle plus one component-composition move (view tabs + theme toggle relocating from `Toolbar` into `Sidebar`).
- `WorkingCopyPanel` — still commented out of `Sidebar.tsx`; this pass doesn't revisit that decision.
- The `Aerial` and `Forge` directions from the mockup — not being built as real components; kept only as reference points in case a future pass wants a density option.
- Command-palette / keyboard-shortcut affordances shown in the mockup's "Forge" direction — not part of Nest, not in scope here.
