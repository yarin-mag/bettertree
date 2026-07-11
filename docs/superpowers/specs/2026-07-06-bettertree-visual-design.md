# Bettertree Visual Design — Dark/Light Theme + Real Tailwind Setup

Date: 2026-07-06

## Purpose

Bettertree's v1 functionality (Plans 1–3) is complete, but the UI has been unstyled the entire time — `tailwindcss` was listed as a devDependency since Plan 1 but never actually wired up (no `tailwind.config.js`, no PostCSS config, no `@tailwind` directives imported anywhere). Every existing `className="bg-blue-600..."` has been inert. This spec covers (1) actually setting up Tailwind, and (2) a "fancy" dark-first developer-tool visual design with a light theme toggle, replacing the ad-hoc gray/blue utility classes used so far.

## Aesthetic Direction

Reference point: dark, sleek developer-tool aesthetic (GitKraken / Linear / Raycast) — approved via mockup review. Generous spacing, subtle borders rather than heavy shadows, soft rounded corners, monospace for hashes/dates/code, icon + label pairing for actions (via `lucide-react`). Accent color: **amber/orange** (approved over indigo/violet and emerald/teal alternatives) — warmer and more energetic than the other two options considered, at the cost of being slightly more attention-grabbing; acceptable per the user's explicit choice after seeing all three side by side.

## Design Tokens

Defined as CSS custom properties on `:root`, switched by a `data-theme="dark"` / `data-theme="light"` attribute on `<html>`. Tailwind's config maps semantic utility classes to these variables so components use ordinary Tailwind classes (`bg-surface`, `text-muted`, etc.), never inline styles or raw hex values.

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg-canvas` | `#121316` | `#ffffff` | App root background |
| `--bg-surface` | `#17181c` | `#fafafa` | Search bar, toolbar, drawer background |
| `--bg-elevated` | `#1e1f24` | `#f2f2f4` | Inputs, buttons, diff file cards, repo pills |
| `--bg-hover` | `#1a1b20` | `#f7f7f8` | Hovered commit rows |
| `--border-subtle` | `#26272c` | `#e4e4e7` | All hairline borders |
| `--text-primary` | `#d3d4da` | `#26272c` | Primary text |
| `--text-muted` | `#6f7078` | `#9a9aa3` | Secondary text (dates, hashes, section labels) |
| `--accent` | `#e8973a` | `#d97a1f` | Primary buttons, active branch, HEAD commit dot, focus rings |
| `--accent-contrast` | `#1a1200` | `#ffffff` | Text/icon color on top of `--accent` |
| `--accent-soft-bg` | `rgba(232,151,58,0.12)` | `rgba(217,122,31,0.10)` | Active branch row background |
| `--success` | `#4ad999` | `#1a9c63` | Diff insertion counts/lines |
| `--danger` | `#f0625f` | `#d64545` | Diff deletion counts/lines |

Light theme uses a darker accent shade than dark theme (`#d97a1f` vs `#e8973a`) to keep sufficient contrast against a white background — approved via the light-theme mockup.

**Typography**: UI text uses the system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`). Commit hashes, timestamps, file paths, and diff content use a monospace stack (`ui-monospace, SFMono-Regular, Menlo, monospace`) — already partially true from Plan 1–3's `font-mono`-style choices in `CommitGraphRow`/`DiffViewer`, now made consistent everywhere hashes/code appear.

## Theming Architecture

- `src/index.css` (new): `@tailwind base; @tailwind components; @tailwind utilities;` plus the `:root[data-theme="dark"]` and `:root[data-theme="light"]` custom property blocks from the table above. Imported once in `src/main.tsx`.
- `tailwind.config.js` (new): no `darkMode` setting needed — components never use Tailwind's built-in `dark:` variant. Instead, `theme.extend.colors` maps each semantic name (`surface`, `elevated`, `border-subtle`, `text-primary`, `text-muted`, `accent`, `accent-contrast`, `success`, `danger`) to `var(--token-name)`, so `bg-surface`, `text-muted`, `border-border-subtle`, etc. work as plain Tailwind utilities whose actual color automatically follows whichever theme's CSS variables are active — no per-component `dark:`/`light:` class duplication needed.
- `postcss.config.js` (new): standard `tailwindcss` + `autoprefixer` pipeline.
- **Flash-of-wrong-theme prevention**: an inline `<script>` in `index.html` (before the app script tag) reads `localStorage.getItem("theme")` (falling back to `"dark"`, the approved default) and sets `document.documentElement.dataset.theme` synchronously, before React mounts or first paint.
- `src/store/themeStore.ts` (new): Zustand store wrapping the current theme (`"dark" | "light"`), a `toggleTheme()` action that flips it, updates `document.documentElement.dataset.theme`, and writes to `localStorage`.
- `src/components/ThemeToggle.tsx` (new): sun/moon icon button (via `lucide-react`) in the `Toolbar`, calls `toggleTheme()`.

## Component Restyle

Every existing component's Tailwind classes are rewritten against the new semantic tokens (`bg-canvas`, `bg-surface`, `bg-elevated`, `bg-hover`, `border-subtle`, `text-primary`, `text-muted`, `accent`, `accent-contrast`, `accent-soft-bg`, `success`, `danger`) instead of the old ad-hoc gray/blue Tailwind defaults (`bg-blue-600`, `text-gray-400`, `border-gray-200`, etc.):

- `App.tsx` — root uses `bg-canvas`.
- `SearchBar.tsx` — `bg-surface` bar, `bg-elevated` input, `lucide-react` `Search` icon prefix.
- `Toolbar.tsx` — `bg-surface`, icon+label buttons (`RefreshCw` for Fetch, `ArrowDownToLine` for Pull, `ArrowUpFromLine` for Push, via `lucide-react`), primary action (Pull, matching the mockup) styled with `accent`/`accent-contrast`, error banner in `danger`, plus the new `ThemeToggle`.
- `Sidebar.tsx`, `RepoList.tsx` — `bg-elevated` repo pills, `Plus`/`FolderPlus` icon on "Add repo".
- `BranchTree.tsx` — `GitBranch` icon for local branches, muted variant for remote, `Tag` icon for tags; active/HEAD branch row uses `accent-soft-bg` background + `accent` text (matches the approved mockup's "● main" treatment, replacing the literal "* " prefix with an icon).
- `WorkingCopyPanel.tsx` — stage/unstage buttons get `Plus`/`Minus` icons; primary Commit button in `accent`.
- `AdvancedSearch.tsx` — consistent input styling with `SearchBar`.
- `CommitGraph.tsx`/`CommitGraphRow.tsx` — HEAD/most-recent-lane dot rendered with a soft glow (box-shadow ring in `accent`, per the mockup), hover state via `bg-hover`.
- `CommitDrawer.tsx` — `bg-surface` panel, `X` icon for the close button (`lucide-react`) instead of the text "Close".
- `DiffViewer.tsx` — unified/side-by-side toggle restyled as a segmented control (active tab in `accent`/`accent-contrast`, per the mockup), insertion/deletion counts in `success`/`danger`.

**Not changing**: any text content used by tests as a selector — button `name`s (`"+ Add repo"`, `"Stage"`, `"Unstage"`, `"Commit"`, `"Search history"`, `"Fetch"`, `"Pull"`, `"Push"`, `"Unified"`, `"Side-by-side"`), placeholders (`"Commit message"`, `"Message or code..."`, `"Author"`, `"Search branches, tags, commits..."`), and `data-testid`s (`commit-row`, `commit-dot`, `search-hit`). Icons are added *alongside* these labels, not replacing them, except the branch-tree HEAD marker (`"* "` text prefix → `GitBranch` icon), which no test currently asserts on directly (Plan 1's `BranchTree` test checks the `data-head` attribute, not the "* " text).

## Testing

- New: `src/store/themeStore.ts` unit test (toggle flips state, writes `data-theme` attribute, persists to `localStorage`).
- New: `ThemeToggle.tsx` component test (click toggles theme).
- Existing component/e2e tests are unaffected — verified above that no test asserts on class names, colors, or the removed "* " text prefix. Full regression (`cargo test` + `npm test` + `npm run e2e`) still runs at the end per the established cross-phase testing policy.
- No new Rust changes in this spec — purely frontend.

## Out of Scope

- Animations/transitions beyond basic hover states (a future polish pass).
- Any change to backend behavior, data shapes, or the three existing plans' functionality.
- Native window chrome theming (Tauri title bar color) — left as a follow-up if it turns out to look mismatched against the new dark theme.
