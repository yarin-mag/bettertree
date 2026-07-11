# Bettertree Diff Syntax Highlighting + Branch Contrast

Date: 2026-07-06

## Purpose

Two readability problems in the current dark/light theme (from the visual design pass): (1) muted text — used for remote branches, commit dates, section labels — is too low-contrast in both themes; (2) the diff viewer shows plain monospace text with only a `+`/`-` character prefix, no syntax highlighting and no visual scan-ability for what changed. This spec fixes both, confirmed via mockup review.

## Branch / Muted-Text Contrast

Bump the shared `--text-muted` CSS custom property in `src/index.css`:

| Theme | Current | New |
|---|---|---|
| Dark | `#6f7078` | `#9a9ba5` |
| Light | `#9a9aa3` | `#5c5d66` |

This is the single token used for remote branch names, commit author/date metadata, and section labels (`Branches`, `Changes`, etc.) — bumping it fixes all of those at once, confirmed as the intended scope (not a branch-specific color).

## Syntax Highlighting

**Library**: `shiki` (new dependency) — the same TextMate-grammar engine VS Code itself uses, chosen over Prism/react-syntax-highlighter specifically to match "looks like VS Code" per the user's request.

**Themes**: `github-dark` for the app's dark theme, `github-light` for light — selected based on `useThemeStore().theme`. Matches the GitHub-style diff line tinting below, so the whole diff view reads as one consistent visual language rather than two unrelated color systems.

**Language detection**: from the file's extension (via its `path` in `FileDiff`), covering at minimum: `ts`/`tsx`/`js`/`jsx` → typescript/tsx, `rs` → rust, `py` → python, `json`, `css`, `html`, `md`, `toml`, `yaml`/`yml`, `sh`. Unknown or missing extensions fall back to plain (unhighlighted) text — not an error, not a blocked render.

**Where it applies**: both the unified patch view and the side-by-side old/new content view in `DiffViewer`. Highlighting is async (Shiki loads grammars on demand): each file's content is highlighted in a `useEffect`, the result cached in local component state, with the existing plain-text `<pre>` rendering shown until it resolves — never a blocked or flashing render.

## Diff Line Tinting

A full-width background tint sits underneath the syntax-highlighted text (not replacing it): a low-opacity green tint (from the existing `--success` token) behind added lines, low-opacity red (from `--danger`) behind removed lines. Applies in both unified and side-by-side modes. Unchanged/context lines get no tint.

## Component Impact

- `src/index.css`: the two `--text-muted` value changes.
- `src/components/DiffViewer.tsx`: rewritten to run content through Shiki per file, render tinted+highlighted lines instead of plain `<pre>` blocks, in both view modes.
- New: a small highlighting helper (`src/lib/highlight.ts`) wrapping Shiki's async API + the extension-to-language mapping, kept separate from `DiffViewer` so the component stays focused on layout/state, not language-detection logic.

## Testing

- `highlight.ts`: unit tests for the extension→language mapping (known extensions map correctly, unknown extensions return a "plaintext" fallback, never throw).
- `DiffViewer`: component test confirming it still renders file paths/stats/patch content correctly with highlighting mocked out (Shiki itself is not something a unit test should invoke for real — mock the highlighter, assert the component wires its output through).
- Full regression (`cargo test`, `npm test`, `npm run e2e`) at the end — no backend changes in this spec, so `cargo test` is just a confirmation pass; existing `DiffViewer`/`CommitDrawer` tests use mocked `FileDiff` fixtures with plain content and must keep passing once highlighting is mocked appropriately.

## Out of Scope

- Highlighting anywhere other than the diff viewer (e.g., no highlighted code in commit messages or search snippets).
- Configurable/user-selectable syntax theme — it's derived automatically from the light/dark toggle, not a separate setting.
- Any change to the diff *data* (patch generation, insertions/deletions counts) — purely a rendering change on top of existing `FileDiff` data.
