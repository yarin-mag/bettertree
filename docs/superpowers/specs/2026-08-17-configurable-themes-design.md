# Configurable Themes — Design

## Problem

App only has 2 hardcoded palettes (dark/light), colors baked into `src/index.css` via `:root[data-theme]` blocks. User wants VSCode-style theming: pick from curated presets, and fully customize/save your own theme.

## Goals

- Preset picker: 5 curated themes (refreshed GitHub Dark, refreshed GitHub Light, Dracula, Solarized Dark, Nord).
- Custom color editor: all 12 base color vars editable per theme.
- Save multiple named custom themes; switch between them like presets.
- Settings modal (gear icon) replaces the old sun/moon `ThemeToggle`.

## Non-goals

- Per-component/scoped theming (single global active theme only).
- Theme import/export or sharing.
- Editing soft-bg variants directly (auto-derived).

## Data model

`src/lib/themes.ts`:

```ts
export type ThemeColors = {
  canvas: string;
  surface: string;
  elevated: string;
  hover: string;
  borderSubtle: string;
  textPrimary: string;
  textMuted: string;
  accent: string;
  accentContrast: string;
  success: string;
  danger: string;
  merged: string;
};

export type PresetTheme = { id: string; name: string; colors: ThemeColors };
export type CustomTheme = { id: string; name: string; colors: ThemeColors };

export const PRESET_THEMES: PresetTheme[]; // 5 entries, see Presets section
```

Soft-bg variants (`accent-soft`, `success-soft`, `danger-soft`, `merged-soft`) are never stored — computed at apply-time as an alpha-blended version of their base color (e.g. `accent` at 15% alpha), same ratio the current dark/light palettes use.

### Presets

1. **GitHub Dark** / **GitHub Light** — current palette values from `index.css`, kept as-is (these are the existing defaults, not automatically "improved" — see Open question below).
2. **Dracula** — standard Dracula palette (`#282a36` bg, `#f8f8f2` fg, `#bd93f9`/`#ff79c6`/`#50fa7b`/`#ff5555` accents) mapped onto the 12 vars.
3. **Solarized Dark** — standard Solarized dark values.
4. **Nord** — standard Nord palette.

## Storage & apply

Remove the static `:root[data-theme="dark"|"light"]` blocks from `index.css`. Active theme colors are applied at runtime by setting each CSS custom property directly:

```ts
function applyTheme(colors: ThemeColors) {
  const root = document.documentElement.style;
  root.setProperty("--bg-canvas", colors.canvas);
  // ...one per var, plus computed soft-bg vars
}
```

`localStorage` keys:
- `theme.active` — `{ type: "preset" | "custom", id: string }`
- `themes.custom` — `CustomTheme[]`

On load: read `theme.active`, resolve colors from presets or custom list. If the referenced custom theme is missing or `themes.custom` fails to parse, fall back to the `GitHub Dark` preset and clear the bad key — never throw.

## Store (`src/store/themeStore.ts`, zustand)

```ts
interface ThemeState {
  activeColors: ThemeColors;
  activeRef: { type: "preset" | "custom"; id: string };
  customThemes: CustomTheme[];
  draft: ThemeColors | null; // live-edit buffer, non-null while editor open

  selectPreset(id: string): void;
  selectCustom(id: string): void;
  startCustomizing(sourceId: string, sourceType: "preset" | "custom"): void; // seeds draft
  updateDraftColor(key: keyof ThemeColors, hex: string): void; // live preview
  saveDraftAs(name: string): void; // new CustomTheme from draft, selects it
  updateExistingCustom(id: string): void; // overwrite an existing custom with draft
  cancelDraft(): void; // discard, revert to activeRef
  deleteCustomTheme(id: string): void;
  renameCustomTheme(id: string, name: string): void;
}
```

`selectPreset`/`selectCustom` call `applyTheme` + persist `theme.active` immediately. `updateDraftColor` calls `applyTheme(draft)` for live preview without persisting until save.

## UI

- **`Toolbar.tsx`**: swap `ThemeToggle` for a gear icon button opening `SettingsModal`.
- **`SettingsModal.tsx`**: modal/panel with a "Theme" section:
  - Grid of preset swatch cards (5), click = `selectPreset`.
  - List of saved custom themes, click = `selectCustom`; each row has rename/delete.
  - "Customize" button next to the currently active theme → opens `ThemeColorEditor` seeded from it.
- **`ThemeColorEditor.tsx`**: 12 labeled rows, each `<input type="color">` + hex text input, edits call `updateDraftColor` (instant live preview via `applyTheme`). Footer: "Save as new" (prompts name → `saveDraftAs`), "Update" (only if editing an existing custom → `updateExistingCustom`), "Cancel" (`cancelDraft`).

## Testing

- `themeStore.test.ts` (rewrite): preset select applies + persists; custom select applies + persists; draft editing doesn't persist until save; corrupt `themes.custom` falls back to GitHub Dark without throwing; delete/rename custom.
- Replace `ThemeToggle.test.tsx` with tests for `SettingsModal` (opens, lists presets/customs, triggers select) and `ThemeColorEditor` (edits update draft/live preview, save creates custom, cancel reverts).
- `themes.ts`: sanity test that all 5 presets define all 12 `ThemeColors` keys with valid hex values.

## Open question for user review

Presets #1/#2 above reuse the *existing* Dark/Light values verbatim (per "keep as-is"), but you said you dislike both current colors. Options: (a) keep GitHub Dark/Light as literal presets for continuity and rely on the other 3 new presets + custom editor to give you a palette you like, or (b) also refresh the Dark/Light preset values themselves as part of this work. Flag which you want before implementation — plan will assume (a) unless you say otherwise.
