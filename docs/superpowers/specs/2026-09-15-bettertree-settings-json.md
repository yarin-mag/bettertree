# Bettertree `settings.json` (theme + font-size + diff-view overrides)

Date: 2026-09-15

## Purpose

The commit-diff drawer had a real bug (raw git header lines like `+++ b/path`
leaking through as doubled `++`/`--` diff rows) and two usability gaps: text
too small, and the drawer too short to read a real diff comfortably. Those
three were fixed directly (`diffLines.ts` header stripping, `text-sm` diff
font, a maximize toggle + full-screen modal on `CommitDrawer`, and per-file
collapse in `DiffViewer`).

This spec covers the remaining, larger ask: a VS Code–style `settings.json`
that (1) persists the existing in-app theme system to a file instead of
`localStorage`, (2) is hot-reloaded — hand-editing the file on disk takes
effect live, the same way the in-app Settings UI does, (3) adds an app-wide
UI font-size setting, and (4) adds font-size and color overrides scoped to
the diff view specifically, without touching font size elsewhere.

## Storage

`settings.json` lives next to the existing `workspace.db`, in
`dirs::data_dir()/bettertree/` (`src-tauri/src/lib.rs` already creates this
directory at startup). Rust treats the file as an opaque `serde_json::Value`
— it never parses or validates individual fields, only the frontend
interprets the schema. This avoids keeping two copies of the schema (Rust
and TypeScript) in sync; Rust's only job is read/write/watch the file.

Two new Tauri commands in `src-tauri/src/commands.rs`:

- `get_settings() -> serde_json::Value` — reads the file; if missing, writes
  `DEFAULT_SETTINGS` (see Schema below) and returns it.
- `write_settings(value: serde_json::Value) -> Result<(), String>` — rejects
  non-object values, otherwise pretty-prints and writes the file.

## Live reload

A background thread, started once in `run()`, watches `settings.json` with
the `notify` crate (new dependency — added to `Cargo.toml`). On any file
change it re-reads and parses the file, then emits a `settings-changed`
Tauri event carrying the parsed JSON.

Writes the app itself makes (via `write_settings`) also re-trigger this
watcher. That's accepted, not suppressed: re-applying identical settings on
the frontend is a no-op, so the redundant event is harmless, and it avoids
building a self-write-suppression mechanism that has no other use.

If a hand-edit produces invalid JSON (e.g. saved mid-edit), the watcher
skips the emit and logs a warning — it never crashes and never overwrites
the user's on-disk file with defaults. The app keeps running on its last
good in-memory settings until the file becomes valid JSON again.

## Schema

```json
{
  "theme": {
    "active": { "type": "preset", "id": "github-dark" },
    "customThemes": []
  },
  "fontSize": {
    "ui": 12,
    "diffView": 14
  },
  "diffViewTheme": null
}
```

- `theme.active` / `theme.customThemes` — exactly today's `ActiveRef` /
  `CustomTheme[]` shape from `themeStore.ts`, moved from the `theme.active`
  / `themes.custom` `localStorage` keys into this file. No shape change.
- `fontSize.ui` (px, default `12`) — the app-wide small-text size (today's
  fixed Tailwind `text-xs`, 0.75rem).
- `fontSize.diffView` (px, default `14`) — the diff view's line-text size
  (today's fixed Tailwind `text-sm`, 0.875rem, applied earlier this
  session).
- `diffViewTheme` — `null`, or a sparse partial `ThemeColors` object with
  only the keys the user wants to override for the diff view specifically;
  any key not present falls back to the active theme's value. Chosen over a
  generic "per-surface overrides map" because only the diff view needs this
  today (YAGNI) — adding another named surface later is a one-line schema
  addition, not a redesign.

## Font-size mechanism

Mirrors the pattern colors already use in `tailwind.config.js`
(`canvas: "var(--bg-canvas)"`, etc.):

```js
// tailwind.config.js
fontSize: {
  xs: ["var(--font-size-xs, 0.75rem)", { lineHeight: "1rem" }],
  sm: ["var(--font-size-sm, 0.875rem)", { lineHeight: "1.25rem" }],
}
```

`fontSize.ui` sets `--font-size-xs` on `document.documentElement` — global,
same mechanism as `applyTheme`. `fontSize.diffView` is set as an inline
style (`--font-size-sm`) on `DiffViewer`'s own wrapper `<div>` only, so it
overrides `text-sm` inside the diff view via normal CSS cascade scoping
without touching `text-sm` anywhere else in the app. No per-component
conditional logic needed beyond that one wrapper.

## Frontend

- `src/lib/tauri.ts`: add `invokeGetSettings()` / `invokeWriteSettings(value)`
  wrapping the two new commands, plus the `Settings` TS type matching the
  schema above.
- `src/store/themeStore.ts`: extended in place (kept as the single settings
  store — no rename, no new parallel store, per the "extend existing"
  decision).
  - Replace the `localStorage`-based `loadCustomThemes` /
    `persistCustomThemes` / `loadInitialRef` / `persistActiveRef` functions
    with calls through `invokeGetSettings` / `invokeWriteSettings`.
  - Add `fontSize: { ui: number; diffView: number }` and
    `diffViewTheme: Partial<ThemeColors> | null` to the store's state.
  - Add actions: `setUiFontSize(px)`, `setDiffViewFontSize(px)`,
    `setDiffViewColor(key, hex | null)` (null clears that one override
    key). Each rebuilds the full settings object from current state and
    calls `invokeWriteSettings`, then applies the relevant CSS var(s)
    locally (no need to wait for the round-tripped `settings-changed`
    event, though receiving it back is harmless).
  - Because `invokeGetSettings` is async (unlike today's synchronous
    `localStorage.getItem`), the store keeps its current synchronous
    default state at module load (github-dark preset, `fontSize` defaults
    above, `diffViewTheme: null`) and applies the real settings once loaded
    — an `initSettings()` function, called once from `App.tsx` on mount,
    fetches settings, applies them, and subscribes to `settings-changed`
    (via `@tauri-apps/api/event`'s `listen`) for the rest of the session. A
    brief flash of default theme/font-size on cold start is accepted for
    v1 (matches how `activeMode`/`applyTheme` already behave before
    `buildInitialState()` runs today — not a regression).
- `src/components/DiffViewer.tsx`: outer wrapper `<div>` gets an inline
  `style` merging `--font-size-sm` (from `fontSize.diffView`) and any
  `diffViewTheme` color overrides (as their corresponding `--bg-*`/`--text-*`
  etc. CSS vars, same `CSS_VAR_MAP` used by `applyTheme` in `lib/themes.ts`,
  exported and reused here rather than duplicated).
- `src/components/SettingsModal.tsx`: two new sections below "Theme":
  - **Font size** — two labeled number inputs (UI, Diff view), calling
    `setUiFontSize` / `setDiffViewFontSize` on change.
  - **Diff view overrides** — the same `FIELDS` list `ThemeColorEditor`
    already uses, each row a swatch + hex input (writing straight to
    `diffViewTheme` via `setDiffViewColor`, not the draft/save-as-name
    flow `ThemeColorEditor` uses for named themes) plus a small reset (×)
    button per field that clears that one key back to "inherit from active
    theme".

## Error handling

- Missing file on first run → Rust writes and returns defaults; no error
  path needed.
- Malformed JSON from a hand-edit → watcher skips the emit (see Live
  reload); frontend never receives a broken payload.
- `write_settings` given a non-object value → command returns an `Err`,
  surfaced as a console warning; not user-facing since it can only happen
  from a frontend bug, not a user action.

## Testing

- Rust: unit test in `src-tauri/src/commands.rs` (or a new
  `settings.rs`) covering get-creates-default-when-missing and a
  write-then-get roundtrip, using a temp dir.
- `themeStore.test.ts` (extend existing theme store tests, currently
  exercised via `reloadThemeFromStorage`): new coverage for
  `setUiFontSize`/`setDiffViewFontSize`/`setDiffViewColor` updating state
  and calling the (mocked) `invokeWriteSettings`.
- `DiffViewer.test.tsx`: extend to assert the wrapper applies
  `--font-size-sm` / override CSS vars when `diffViewTheme`/`fontSize` are
  set on the store.
- Full regression (`cargo test`, `npx vitest run`) at the end.

## Out of Scope

- Per-surface overrides for anything other than the diff view (sidebar,
  toolbar, commit list keep using the app-wide `fontSize.ui` /active theme
  only) — confirmed scope decision, not a placeholder.
- A `$schema` field / JSON-schema validation for hand-editing
  ergonomics — nice-to-have, not required for this to work.
- Syncing settings across machines/cloud — purely a local file.
