# Configurable Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's hardcoded dark/light toggle with a VSCode-style theme system: 5 curated presets, a full custom color editor, and support for saving multiple named custom themes.

**Architecture:** Theme color values move out of static CSS (`:root[data-theme]` blocks) into a data-driven `ThemeColors` model applied at runtime via `documentElement.style.setProperty`. A rewritten zustand `themeStore` owns preset selection, custom-theme CRUD, and a live "draft" buffer for the color editor. A new `SettingsModal` (opened from a gear icon in `Sidebar`, replacing the old `ThemeToggle`) hosts the preset picker, saved custom themes list, and the color editor.

**Tech Stack:** React 18, TypeScript, zustand (no persist middleware — plain `localStorage` reads/writes to match the existing pattern), Tailwind (CSS vars already wired into `tailwind.config.js`), Vitest + Testing Library, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-08-17-configurable-themes-design.md`

## Global Constraints

- All 12 base color values are hex strings (`#rrggbb`); no other formats are stored.
- Soft-bg variants (`--accent-soft-bg`, `--success-soft-bg`, `--danger-soft-bg`, `--merged-soft-bg`) are never stored — always computed at apply-time as the base color at 15% alpha.
- Presets #1/#2 (GitHub Dark, GitHub Light) reuse the exact existing color values from `src/index.css` verbatim (per user decision — not refreshed as part of this work).
- `localStorage` keys: `theme.active` (`{type: "preset"|"custom", id: string}`), `themes.custom` (`CustomTheme[]`). Corrupt or missing data must fall back to the `github-dark` preset without throwing.
- No git commits — this project (`bettertree`) is intentionally not tracked in git. Skip all `git add`/`git commit` steps below; run the test commands but stop after each passes.

---

### Task 1: Theme data model (`src/lib/themes.ts`)

**Files:**
- Create: `src/lib/themes.ts`
- Test: `src/__tests__/themes.test.ts`

**Interfaces:**
- Produces: `type ThemeColors` (12 keys: `canvas, surface, elevated, hover, borderSubtle, textPrimary, textMuted, accent, accentContrast, success, danger, merged`, all `string`), `type PresetTheme = {id: string; name: string; colors: ThemeColors}`, `type CustomTheme = {id: string; name: string; colors: ThemeColors}`, `PRESET_THEMES: PresetTheme[]` (5 entries, ids: `github-dark`, `github-light`, `dracula`, `solarized-dark`, `nord`), `hexToRgba(hex: string, alpha: number): string`, `isDarkColor(hex: string): boolean`, `applyTheme(colors: ThemeColors): "dark" | "light"` (sets all CSS vars + `data-theme-mode` on `documentElement`, returns the resolved mode).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/themes.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { PRESET_THEMES, isDarkColor, hexToRgba, applyTheme } from "../lib/themes";

const REQUIRED_KEYS = [
  "canvas", "surface", "elevated", "hover", "borderSubtle",
  "textPrimary", "textMuted", "accent", "accentContrast",
  "success", "danger", "merged",
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

describe("themes", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme-mode");
  });

  it("defines exactly 5 presets", () => {
    expect(PRESET_THEMES).toHaveLength(5);
  });

  it("every preset defines all 12 color keys with valid hex values", () => {
    for (const preset of PRESET_THEMES) {
      for (const key of REQUIRED_KEYS) {
        expect(preset.colors[key]).toMatch(HEX_RE);
      }
    }
  });

  it("every preset has a unique id", () => {
    const ids = PRESET_THEMES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("isDarkColor identifies dark and light backgrounds correctly", () => {
    expect(isDarkColor("#0d1117")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
  });

  it("hexToRgba converts hex + alpha to an rgba string", () => {
    expect(hexToRgba("#3fb96a", 0.15)).toBe("rgba(63, 185, 106, 0.15)");
  });

  it("applyTheme sets CSS vars and returns the resolved mode", () => {
    const mode = applyTheme(PRESET_THEMES.find((p) => p.id === "github-dark")!.colors);
    expect(mode).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--bg-canvas")).toBe("#0d1117");
    expect(document.documentElement.style.getPropertyValue("--accent-soft-bg")).toBe("rgba(63, 185, 106, 0.15)");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/themes.test.ts`
Expected: FAIL — `src/lib/themes.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/themes.ts
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

const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
  canvas: "--bg-canvas",
  surface: "--bg-surface",
  elevated: "--bg-elevated",
  hover: "--bg-hover",
  borderSubtle: "--border-subtle",
  textPrimary: "--text-primary",
  textMuted: "--text-muted",
  accent: "--accent",
  accentContrast: "--accent-contrast",
  success: "--success",
  danger: "--danger",
  merged: "--merged",
};

const SOFT_ALPHA = 0.15;

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function isDarkColor(hex: string): boolean {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

export function applyTheme(colors: ThemeColors): "dark" | "light" {
  const root = document.documentElement.style;
  (Object.keys(CSS_VAR_MAP) as Array<keyof ThemeColors>).forEach((key) => {
    root.setProperty(CSS_VAR_MAP[key], colors[key]);
  });
  root.setProperty("--accent-soft-bg", hexToRgba(colors.accent, SOFT_ALPHA));
  root.setProperty("--success-soft-bg", hexToRgba(colors.success, SOFT_ALPHA));
  root.setProperty("--danger-soft-bg", hexToRgba(colors.danger, SOFT_ALPHA));
  root.setProperty("--merged-soft-bg", hexToRgba(colors.merged, SOFT_ALPHA));
  const mode = isDarkColor(colors.canvas) ? "dark" : "light";
  document.documentElement.dataset.themeMode = mode;
  return mode;
}

export const PRESET_THEMES: PresetTheme[] = [
  {
    id: "github-dark",
    name: "GitHub Dark",
    colors: {
      canvas: "#0d1117",
      surface: "#161b22",
      elevated: "#1c232c",
      hover: "#1c2733",
      borderSubtle: "#30363d",
      textPrimary: "#e6edf3",
      textMuted: "#8b949e",
      accent: "#3fb96a",
      accentContrast: "#04170c",
      success: "#3fb950",
      danger: "#f85149",
      merged: "#a371f7",
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    colors: {
      canvas: "#ffffff",
      surface: "#f6f8fa",
      elevated: "#eef1f4",
      hover: "#eaeef2",
      borderSubtle: "#d0d7de",
      textPrimary: "#1f2328",
      textMuted: "#59636e",
      accent: "#1a7f37",
      accentContrast: "#ffffff",
      success: "#1a7f37",
      danger: "#cf222e",
      merged: "#8250df",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    colors: {
      canvas: "#282a36",
      surface: "#21222c",
      elevated: "#343746",
      hover: "#44475a",
      borderSubtle: "#44475a",
      textPrimary: "#f8f8f2",
      textMuted: "#6272a4",
      accent: "#bd93f9",
      accentContrast: "#1e1f29",
      success: "#50fa7b",
      danger: "#ff5555",
      merged: "#ff79c6",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    colors: {
      canvas: "#002b36",
      surface: "#073642",
      elevated: "#0a3f4c",
      hover: "#0d4855",
      borderSubtle: "#586e75",
      textPrimary: "#93a1a1",
      textMuted: "#657b83",
      accent: "#268bd2",
      accentContrast: "#002b36",
      success: "#859900",
      danger: "#dc322f",
      merged: "#6c71c4",
    },
  },
  {
    id: "nord",
    name: "Nord",
    colors: {
      canvas: "#2e3440",
      surface: "#3b4252",
      elevated: "#434c5e",
      hover: "#4c566a",
      borderSubtle: "#4c566a",
      textPrimary: "#eceff4",
      textMuted: "#d8dee9",
      accent: "#88c0d0",
      accentContrast: "#2e3440",
      success: "#a3be8c",
      danger: "#bf616a",
      merged: "#b48ead",
    },
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/themes.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

Skip (no git in this project).

---

### Task 2: Rewrite `themeStore` — selection, persistence, fallback

**Files:**
- Modify: `src/store/themeStore.ts` (full rewrite)
- Modify: `src/__tests__/themeStore.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `PRESET_THEMES`, `ThemeColors`, `CustomTheme`, `applyTheme` from `../lib/themes` (Task 1).
- Produces (this task's slice — extended in Task 3): `useThemeStore` with state `activeRef: {type: "preset"|"custom"; id: string}`, `activeColors: ThemeColors`, `activeMode: "dark"|"light"`, `customThemes: CustomTheme[]`, `draft: ThemeColors | null`, `draftSourceId: string | null`; actions `selectPreset(id: string): void`, `selectCustom(id: string): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/themeStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore, reloadThemeFromStorage } from "../store/themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme-mode");
    useThemeStore.getState().selectPreset("github-dark");
    useThemeStore.setState({ customThemes: [] });
    localStorage.removeItem("themes.custom");
  });

  it("selectPreset applies colors, updates state, and persists the choice", () => {
    useThemeStore.getState().selectPreset("dracula");
    const state = useThemeStore.getState();
    expect(state.activeRef).toEqual({ type: "preset", id: "dracula" });
    expect(state.activeColors.canvas).toBe("#282a36");
    expect(state.activeMode).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--bg-canvas")).toBe("#282a36");
    expect(JSON.parse(localStorage.getItem("theme.active")!)).toEqual({ type: "preset", id: "dracula" });
  });

  it("selectPreset with GitHub Light resolves activeMode to light", () => {
    useThemeStore.getState().selectPreset("github-light");
    expect(useThemeStore.getState().activeMode).toBe("light");
  });

  it("selectPreset ignores unknown ids", () => {
    const before = useThemeStore.getState().activeRef;
    useThemeStore.getState().selectPreset("does-not-exist");
    expect(useThemeStore.getState().activeRef).toEqual(before);
  });

  it("selectCustom applies a saved custom theme", () => {
    const custom = { id: "c1", name: "Mine", colors: useThemeStore.getState().activeColors };
    useThemeStore.setState({ customThemes: [custom] });
    useThemeStore.getState().selectCustom("c1");
    expect(useThemeStore.getState().activeRef).toEqual({ type: "custom", id: "c1" });
  });

  it("falls back to github-dark when theme.active references a missing custom theme", () => {
    localStorage.setItem("theme.active", JSON.stringify({ type: "custom", id: "missing" }));
    localStorage.setItem("themes.custom", JSON.stringify([]));
    useThemeStore.setState(reloadThemeFromStorage());
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
  });

  it("falls back to github-dark when localStorage contains corrupt JSON", () => {
    localStorage.setItem("theme.active", "not json");
    localStorage.setItem("themes.custom", "also not json");
    expect(() => useThemeStore.setState(reloadThemeFromStorage())).not.toThrow();
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/themeStore.test.ts`
Expected: FAIL — old store has no `selectPreset`/`selectCustom`, `theme`/`toggleTheme` API mismatch.

- [ ] **Step 3: Write the implementation**

```ts
// src/store/themeStore.ts
import { create } from "zustand";
import { PRESET_THEMES, applyTheme, type ThemeColors, type CustomTheme } from "../lib/themes";

const ACTIVE_KEY = "theme.active";
const CUSTOM_KEY = "themes.custom";
const DEFAULT_PRESET_ID = "github-dark";

type ActiveRef = { type: "preset" | "custom"; id: string };

interface ThemeState {
  activeRef: ActiveRef;
  activeColors: ThemeColors;
  activeMode: "dark" | "light";
  customThemes: CustomTheme[];
  draft: ThemeColors | null;
  draftSourceId: string | null;

  selectPreset: (id: string) => void;
  selectCustom: (id: string) => void;
}

function defaultColors(): ThemeColors {
  return PRESET_THEMES.find((p) => p.id === DEFAULT_PRESET_ID)!.colors;
}

function loadCustomThemes(): CustomTheme[] {
  const raw = localStorage.getItem(CUSTOM_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistCustomThemes(themes: CustomTheme[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(themes));
}

function persistActiveRef(ref: ActiveRef) {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(ref));
}

function loadInitialRef(customThemes: CustomTheme[]): ActiveRef {
  const raw = localStorage.getItem(ACTIVE_KEY);
  if (!raw) return { type: "preset", id: DEFAULT_PRESET_ID };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: "preset", id: DEFAULT_PRESET_ID };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    ((parsed as ActiveRef).type !== "preset" && (parsed as ActiveRef).type !== "custom") ||
    typeof (parsed as ActiveRef).id !== "string"
  ) {
    return { type: "preset", id: DEFAULT_PRESET_ID };
  }
  const ref = parsed as ActiveRef;
  if (ref.type === "custom" && !customThemes.some((c) => c.id === ref.id)) {
    return { type: "preset", id: DEFAULT_PRESET_ID };
  }
  if (ref.type === "preset" && !PRESET_THEMES.some((p) => p.id === ref.id)) {
    return { type: "preset", id: DEFAULT_PRESET_ID };
  }
  return ref;
}

function resolveColors(ref: ActiveRef, customThemes: CustomTheme[]): ThemeColors {
  if (ref.type === "preset") {
    return PRESET_THEMES.find((p) => p.id === ref.id)?.colors ?? defaultColors();
  }
  return customThemes.find((c) => c.id === ref.id)?.colors ?? defaultColors();
}

function buildInitialState() {
  const customThemes = loadCustomThemes();
  const activeRef = loadInitialRef(customThemes);
  const activeColors = resolveColors(activeRef, customThemes);
  const activeMode = applyTheme(activeColors);
  return { activeRef, activeColors, activeMode, customThemes };
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...buildInitialState(),
  draft: null,
  draftSourceId: null,

  selectPreset: (id) => {
    const preset = PRESET_THEMES.find((p) => p.id === id);
    if (!preset) return;
    const ref: ActiveRef = { type: "preset", id };
    const mode = applyTheme(preset.colors);
    persistActiveRef(ref);
    set({ activeRef: ref, activeColors: preset.colors, activeMode: mode, draft: null, draftSourceId: null });
  },

  selectCustom: (id) => {
    const custom = get().customThemes.find((c) => c.id === id);
    if (!custom) return;
    const ref: ActiveRef = { type: "custom", id };
    const mode = applyTheme(custom.colors);
    persistActiveRef(ref);
    set({ activeRef: ref, activeColors: custom.colors, activeMode: mode, draft: null, draftSourceId: null });
  },
}));

// Re-reads localStorage and rebuilds theme state from scratch. Used by tests
// that mutate localStorage directly to simulate app startup with different
// stored data (the store itself only reads localStorage once, at module load).
export function reloadThemeFromStorage() {
  return { ...buildInitialState(), draft: null, draftSourceId: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/themeStore.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

Skip (no git in this project).

---

### Task 3: Extend `themeStore` — draft editing and custom-theme CRUD

**Files:**
- Modify: `src/store/themeStore.ts:1-` (add to the `ThemeState` interface and store body from Task 2)
- Modify: `src/__tests__/themeStore.test.ts` (append tests)

**Interfaces:**
- Consumes: `ThemeState` base from Task 2 (`activeRef`, `activeColors`, `activeMode`, `customThemes`, `draft`, `draftSourceId`, `selectPreset`, `selectCustom`).
- Produces: `startCustomizing(sourceId: string, sourceType: "preset" | "custom"): void`, `updateDraftColor(key: keyof ThemeColors, hex: string): void`, `saveDraftAs(name: string): void`, `updateExistingCustom(): void`, `cancelDraft(): void`, `deleteCustomTheme(id: string): void`, `renameCustomTheme(id: string, name: string): void`. These are consumed by `ThemeColorEditor` (Task 4) and `SettingsModal` (Task 5).

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/themeStore.test.ts`:

```ts
describe("themeStore draft + custom CRUD", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.getState().selectPreset("github-dark");
    useThemeStore.setState({ customThemes: [] });
  });

  it("startCustomizing seeds a draft copy without a source id for a preset", () => {
    useThemeStore.getState().startCustomizing("dracula", "preset");
    const state = useThemeStore.getState();
    expect(state.draft?.canvas).toBe("#282a36");
    expect(state.draftSourceId).toBeNull();
  });

  it("updateDraftColor live-applies the change without persisting activeRef", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().updateDraftColor("accent", "#ff00ff");
    expect(useThemeStore.getState().draft?.accent).toBe("#ff00ff");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#ff00ff");
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
  });

  it("saveDraftAs creates a new custom theme, persists it, and selects it", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().updateDraftColor("accent", "#ff00ff");
    useThemeStore.getState().saveDraftAs("My Theme");
    const state = useThemeStore.getState();
    expect(state.customThemes).toHaveLength(1);
    expect(state.customThemes[0].name).toBe("My Theme");
    expect(state.customThemes[0].colors.accent).toBe("#ff00ff");
    expect(state.activeRef).toEqual({ type: "custom", id: state.customThemes[0].id });
    expect(state.draft).toBeNull();
    expect(JSON.parse(localStorage.getItem("themes.custom")!)).toHaveLength(1);
  });

  it("startCustomizing on a custom theme sets draftSourceId, and updateExistingCustom overwrites it in place", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("Mine");
    const id = useThemeStore.getState().customThemes[0].id;
    useThemeStore.getState().startCustomizing(id, "custom");
    expect(useThemeStore.getState().draftSourceId).toBe(id);
    useThemeStore.getState().updateDraftColor("danger", "#123456");
    useThemeStore.getState().updateExistingCustom();
    const state = useThemeStore.getState();
    expect(state.customThemes).toHaveLength(1);
    expect(state.customThemes[0].colors.danger).toBe("#123456");
    expect(state.draft).toBeNull();
  });

  it("cancelDraft discards the draft and reverts the live preview to activeColors", () => {
    useThemeStore.getState().selectPreset("dracula");
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().updateDraftColor("accent", "#ff00ff");
    useThemeStore.getState().cancelDraft();
    expect(useThemeStore.getState().draft).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--bg-canvas")).toBe("#282a36");
  });

  it("deleteCustomTheme removes it and falls back to github-dark if it was active", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("Mine");
    const id = useThemeStore.getState().customThemes[0].id;
    useThemeStore.getState().deleteCustomTheme(id);
    const state = useThemeStore.getState();
    expect(state.customThemes).toHaveLength(0);
    expect(state.activeRef).toEqual({ type: "preset", id: "github-dark" });
  });

  it("renameCustomTheme updates the name and persists it", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("Mine");
    const id = useThemeStore.getState().customThemes[0].id;
    useThemeStore.getState().renameCustomTheme(id, "Renamed");
    expect(useThemeStore.getState().customThemes[0].name).toBe("Renamed");
    expect(JSON.parse(localStorage.getItem("themes.custom")!)[0].name).toBe("Renamed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/themeStore.test.ts`
Expected: FAIL — `startCustomizing`, `updateDraftColor`, etc. are not defined.

- [ ] **Step 3: Write the implementation**

Extend the `ThemeState` interface in `src/store/themeStore.ts`:

```ts
interface ThemeState {
  activeRef: ActiveRef;
  activeColors: ThemeColors;
  activeMode: "dark" | "light";
  customThemes: CustomTheme[];
  draft: ThemeColors | null;
  draftSourceId: string | null;

  selectPreset: (id: string) => void;
  selectCustom: (id: string) => void;
  startCustomizing: (sourceId: string, sourceType: "preset" | "custom") => void;
  updateDraftColor: (key: keyof ThemeColors, hex: string) => void;
  saveDraftAs: (name: string) => void;
  updateExistingCustom: () => void;
  cancelDraft: () => void;
  deleteCustomTheme: (id: string) => void;
  renameCustomTheme: (id: string, name: string) => void;
}
```

Add these actions to the `create<ThemeState>((set, get) => ({ ... }))` body, alongside `selectPreset`/`selectCustom`:

```ts
  startCustomizing: (sourceId, sourceType) => {
    const source =
      sourceType === "preset"
        ? PRESET_THEMES.find((p) => p.id === sourceId)
        : get().customThemes.find((c) => c.id === sourceId);
    if (!source) return;
    set({
      draft: { ...source.colors },
      draftSourceId: sourceType === "custom" ? sourceId : null,
    });
  },

  updateDraftColor: (key, hex) => {
    const draft = get().draft;
    if (!draft) return;
    const next = { ...draft, [key]: hex };
    applyTheme(next);
    set({ draft: next });
  },

  saveDraftAs: (name) => {
    const draft = get().draft;
    if (!draft) return;
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const theme: CustomTheme = { id, name, colors: draft };
    const customThemes = [...get().customThemes, theme];
    persistCustomThemes(customThemes);
    const ref: ActiveRef = { type: "custom", id };
    const mode = applyTheme(draft);
    persistActiveRef(ref);
    set({ customThemes, activeRef: ref, activeColors: draft, activeMode: mode, draft: null, draftSourceId: null });
  },

  updateExistingCustom: () => {
    const { draft, draftSourceId, customThemes } = get();
    if (!draft || !draftSourceId) return;
    const updated = customThemes.map((c) => (c.id === draftSourceId ? { ...c, colors: draft } : c));
    persistCustomThemes(updated);
    const ref: ActiveRef = { type: "custom", id: draftSourceId };
    const mode = applyTheme(draft);
    persistActiveRef(ref);
    set({ customThemes: updated, activeRef: ref, activeColors: draft, activeMode: mode, draft: null, draftSourceId: null });
  },

  cancelDraft: () => {
    applyTheme(get().activeColors);
    set({ draft: null, draftSourceId: null });
  },

  deleteCustomTheme: (id) => {
    const { customThemes, activeRef } = get();
    const remaining = customThemes.filter((c) => c.id !== id);
    persistCustomThemes(remaining);
    if (activeRef.type === "custom" && activeRef.id === id) {
      const fallback = defaultColors();
      const ref: ActiveRef = { type: "preset", id: DEFAULT_PRESET_ID };
      const mode = applyTheme(fallback);
      persistActiveRef(ref);
      set({ customThemes: remaining, activeRef: ref, activeColors: fallback, activeMode: mode });
    } else {
      set({ customThemes: remaining });
    }
  },

  renameCustomTheme: (id, name) => {
    const updated = get().customThemes.map((c) => (c.id === id ? { ...c, name } : c));
    persistCustomThemes(updated);
    set({ customThemes: updated });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/themeStore.test.ts`
Expected: PASS (13 tests total)

- [ ] **Step 5: Commit**

Skip (no git in this project).

---

### Task 4: `ThemeColorEditor` component

**Files:**
- Create: `src/components/ThemeColorEditor.tsx`
- Test: `src/__tests__/ThemeColorEditor.test.tsx`

**Interfaces:**
- Consumes: `useThemeStore` fields `draft`, `draftSourceId` and actions `updateDraftColor`, `saveDraftAs`, `updateExistingCustom`, `cancelDraft` (Task 3); `type ThemeColors` (Task 1).
- Produces: default-exported `ThemeColorEditor` component, no props, reads/writes the store directly. Renders `null` when `draft` is `null`. Consumed by `SettingsModal` (Task 5).

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/ThemeColorEditor.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useThemeStore } from "../store/themeStore";
import ThemeColorEditor from "../components/ThemeColorEditor";

describe("ThemeColorEditor", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.getState().selectPreset("github-dark");
    useThemeStore.setState({ customThemes: [], draft: null, draftSourceId: null });
  });

  it("renders nothing when there is no draft", () => {
    const { container } = render(<ThemeColorEditor />);
    expect(container).toBeEmptyDOMElement();
  });

  it("editing a color field updates the draft live", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    render(<ThemeColorEditor />);
    fireEvent.change(screen.getByLabelText("Accent"), { target: { value: "#ff0000" } });
    expect(useThemeStore.getState().draft?.accent).toBe("#ff0000");
  });

  it("saving as new creates a custom theme and selects it", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    render(<ThemeColorEditor />);
    fireEvent.change(screen.getByPlaceholderText("Theme name"), { target: { value: "My Theme" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
    const state = useThemeStore.getState();
    expect(state.customThemes).toHaveLength(1);
    expect(state.customThemes[0].name).toBe("My Theme");
    expect(state.draft).toBeNull();
  });

  it("shows an Update button instead of the name field when editing an existing custom theme", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("Mine");
    const id = useThemeStore.getState().customThemes[0].id;
    useThemeStore.getState().startCustomizing(id, "custom");
    render(<ThemeColorEditor />);
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Theme name")).not.toBeInTheDocument();
  });

  it("cancel discards the draft", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    render(<ThemeColorEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useThemeStore.getState().draft).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/ThemeColorEditor.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/ThemeColorEditor.tsx
import { useState } from "react";
import { useThemeStore } from "../store/themeStore";
import type { ThemeColors } from "../lib/themes";

const FIELDS: Array<{ key: keyof ThemeColors; label: string }> = [
  { key: "canvas", label: "Canvas background" },
  { key: "surface", label: "Surface background" },
  { key: "elevated", label: "Elevated background" },
  { key: "hover", label: "Hover background" },
  { key: "borderSubtle", label: "Border" },
  { key: "textPrimary", label: "Primary text" },
  { key: "textMuted", label: "Muted text" },
  { key: "accent", label: "Accent" },
  { key: "accentContrast", label: "Accent contrast text" },
  { key: "success", label: "Success" },
  { key: "danger", label: "Danger" },
  { key: "merged", label: "Merged" },
];

export default function ThemeColorEditor() {
  const { draft, draftSourceId, updateDraftColor, saveDraftAs, updateExistingCustom, cancelDraft } = useThemeStore();
  const [newName, setNewName] = useState("");

  if (!draft) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {FIELDS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-2 text-xs text-text-primary">
            <span>{label}</span>
            <span className="flex items-center gap-2">
              <input
                type="color"
                aria-label={label}
                value={draft[key]}
                onChange={(e) => updateDraftColor(key, e.target.value)}
                className="h-6 w-8 rounded border border-border-subtle bg-transparent"
              />
              <input
                type="text"
                aria-label={`${label} hex value`}
                value={draft[key]}
                onChange={(e) => updateDraftColor(key, e.target.value)}
                className="w-20 bg-elevated border border-border-subtle rounded px-1.5 py-0.5 text-xs text-text-primary"
              />
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
        {draftSourceId ? (
          <button
            type="button"
            className="text-xs px-2 py-1 rounded bg-accent text-accent-contrast"
            onClick={updateExistingCustom}
          >
            Update
          </button>
        ) : (
          <>
            <input
              type="text"
              placeholder="Theme name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 bg-elevated border border-border-subtle rounded px-2 py-1 text-xs text-text-primary"
            />
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-accent text-accent-contrast disabled:opacity-50"
              disabled={!newName.trim()}
              onClick={() => saveDraftAs(newName.trim())}
            >
              Save as new
            </button>
          </>
        )}
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-border-subtle text-text-primary"
          onClick={cancelDraft}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/ThemeColorEditor.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

Skip (no git in this project).

---

### Task 5: `SettingsModal` component

**Files:**
- Create: `src/components/SettingsModal.tsx`
- Test: `src/__tests__/SettingsModal.test.tsx`

**Interfaces:**
- Consumes: `useThemeStore` fields `activeRef`, `customThemes`, `draft` and actions `selectPreset`, `selectCustom`, `startCustomizing`, `deleteCustomTheme`, `renameCustomTheme` (Task 3); `PRESET_THEMES` (Task 1); `ThemeColorEditor` (Task 4).
- Produces: default-exported `SettingsModal({onClose: () => void})`. Consumed by `Sidebar` (Task 6).

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/SettingsModal.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useThemeStore } from "../store/themeStore";
import SettingsModal from "../components/SettingsModal";

describe("SettingsModal", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ customThemes: [], draft: null, draftSourceId: null });
    useThemeStore.getState().selectPreset("github-dark");
  });

  it("lists all 5 presets", () => {
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText("GitHub Dark")).toBeInTheDocument();
    expect(screen.getByText("GitHub Light")).toBeInTheDocument();
    expect(screen.getByText("Dracula")).toBeInTheDocument();
    expect(screen.getByText("Solarized Dark")).toBeInTheDocument();
    expect(screen.getByText("Nord")).toBeInTheDocument();
  });

  it("clicking a preset selects it", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByText("Dracula"));
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "dracula" });
  });

  it("clicking the close button calls onClose", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("pressing Escape calls onClose", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking Customize on a preset opens the color editor", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Customize GitHub Dark" }));
    expect(screen.getByPlaceholderText("Theme name")).toBeInTheDocument();
  });

  it("shows saved custom themes and lets you select them", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("My Theme");
    useThemeStore.getState().selectPreset("github-dark");
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByText("My Theme"));
    expect(useThemeStore.getState().activeRef.type).toBe("custom");
  });

  it("deleting a custom theme removes it from the list", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("My Theme");
    useThemeStore.getState().selectPreset("github-dark");
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete My Theme" }));
    expect(useThemeStore.getState().customThemes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/SettingsModal.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/SettingsModal.tsx
import { useEffect, useState } from "react";
import { X, Palette, Pencil, Trash2 } from "lucide-react";
import { useThemeStore } from "../store/themeStore";
import { PRESET_THEMES } from "../lib/themes";
import ThemeColorEditor from "./ThemeColorEditor";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const {
    activeRef,
    customThemes,
    draft,
    selectPreset,
    selectCustom,
    startCustomizing,
    deleteCustomTheme,
    renameCustomTheme,
  } = useThemeStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[28rem] max-h-[80vh] overflow-y-auto bg-surface border border-border-subtle rounded-lg shadow-lg p-4 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Theme</h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Presets</div>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_THEMES.map((preset) => {
              const isActive = activeRef.type === "preset" && activeRef.id === preset.id && !draft;
              return (
                <div
                  key={preset.id}
                  role="button"
                  tabIndex={0}
                  className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs cursor-pointer ${
                    isActive ? "border-accent" : "border-border-subtle"
                  }`}
                  onClick={() => selectPreset(preset.id)}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-full border border-border-subtle"
                      style={{ backgroundColor: preset.colors.accent }}
                    />
                    <span className="text-text-primary">{preset.name}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Customize ${preset.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      startCustomizing(preset.id, "preset");
                    }}
                    className="text-text-muted hover:text-text-primary"
                  >
                    <Palette size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {customThemes.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Custom themes</div>
            <div className="flex flex-col gap-1">
              {customThemes.map((custom) => {
                const isActive = activeRef.type === "custom" && activeRef.id === custom.id && !draft;
                return (
                  <div
                    key={custom.id}
                    role="button"
                    tabIndex={0}
                    className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs cursor-pointer ${
                      isActive ? "border-accent" : "border-border-subtle"
                    }`}
                    onClick={() => selectCustom(custom.id)}
                  >
                    {renamingId === custom.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => {
                          if (renameValue.trim()) renameCustomTheme(custom.id, renameValue.trim());
                          setRenamingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        className="flex-1 bg-elevated border border-border-subtle rounded px-1 text-text-primary"
                      />
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-3 w-3 rounded-full border border-border-subtle"
                          style={{ backgroundColor: custom.colors.accent }}
                        />
                        <span className="text-text-primary">{custom.name}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Rename ${custom.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(custom.id);
                          setRenameValue(custom.name);
                        }}
                        className="text-text-muted hover:text-text-primary"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Customize ${custom.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          startCustomizing(custom.id, "custom");
                        }}
                        className="text-text-muted hover:text-text-primary"
                      >
                        <Palette size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${custom.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCustomTheme(custom.id);
                        }}
                        className="text-text-muted hover:text-danger"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {draft && (
          <div>
            <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Customize</div>
            <ThemeColorEditor />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/SettingsModal.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

Skip (no git in this project).

---

### Task 6: Wire it up — Sidebar, DiffViewer, index.css, remove ThemeToggle

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/__tests__/Sidebar.test.tsx`
- Modify: `src/components/DiffViewer.tsx:34`
- Modify: `src/index.css:5-41,64-67`
- Delete: `src/components/ThemeToggle.tsx`
- Delete: `src/__tests__/ThemeToggle.test.tsx`

**Interfaces:**
- Consumes: `SettingsModal` (Task 5), `useThemeStore().activeMode` (Task 2).

- [ ] **Step 1: Write the failing test**

Replace the last test in `src/__tests__/Sidebar.test.tsx` (the one checking for the theme toggle):

```tsx
  it("shows the active repo path and a settings button in the sidebar footer", () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/repo-a", name: "repo-a", pinned: false }],
      activeRepoId: 1,
    });
    render(<Sidebar />);
    expect(screen.getByText("/tmp/repo-a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
  });

  it("opens the settings modal when the settings button is clicked", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.getByText("Theme")).toBeInTheDocument();
  });
```

Add `fireEvent` to the existing `import { render, screen } from "@testing-library/react";` line (becomes `import { render, screen, fireEvent } from "@testing-library/react";`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/Sidebar.test.tsx`
Expected: FAIL — no "Open settings" button exists yet; old test also still references the removed toggle until Step 3 replaces it.

- [ ] **Step 3: Write the implementation**

`src/components/Sidebar.tsx` — replace the `ThemeToggle` import and usage:

```tsx
import { useState } from "react";
import { GitBranch, GitPullRequest, GitCompare, Settings } from "lucide-react";
import { useViewStore } from "../store/viewStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import RepoList from "./RepoList";
import BranchTree from "./BranchTree";
// import WorkingCopyPanel from "./WorkingCopyPanel";
import ResizeHandle from "./ResizeHandle";
import SettingsModal from "./SettingsModal";
import { useResizable } from "../hooks/useResizable";

const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function Sidebar() {
  const { size, onMouseDown } = useResizable(256, MIN_WIDTH, MAX_WIDTH, "x");
  const { activeView, setActiveView } = useViewStore();
  const { activeRepoId, repos } = useWorkspaceStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div
      className="relative flex-shrink-0 border-r border-border-subtle bg-surface h-full flex flex-col"
      style={{ width: size }}
    >
      <div className="flex items-center gap-1 p-2 border-b border-border-subtle">
        <button
          type="button"
          className={`flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded ${
            activeView === "repo" ? "bg-accent text-accent-contrast" : "bg-elevated border border-border-subtle text-text-primary"
          }`}
          onClick={() => setActiveView("repo")}
        >
          <GitBranch size={12} />
          Repo
        </button>
        <button
          type="button"
          className={`flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded ${
            activeView === "pulls" ? "bg-accent text-accent-contrast" : "bg-elevated border border-border-subtle text-text-primary"
          }`}
          onClick={() => setActiveView("pulls")}
        >
          <GitPullRequest size={12} />
          PRs
        </button>
        <button
          type="button"
          className={`flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded ${
            activeView === "compare" ? "bg-accent text-accent-contrast" : "bg-elevated border border-border-subtle text-text-primary"
          }`}
          onClick={() => setActiveView("compare")}
        >
          <GitCompare size={12} />
          Compare
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <RepoList />
        <BranchTree />
        {/* <WorkingCopyPanel /> — hidden until Staged/Changes split is designed */}
      </div>
      <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border-subtle">
        <span className="flex-1 min-w-0 truncate text-xs text-text-muted" title={activeRepo?.path ?? ""}>
          {activeRepo?.path ?? ""}
        </span>
        <button
          type="button"
          aria-label="Open settings"
          className="text-text-muted hover:text-text-primary px-1"
          onClick={() => setIsSettingsOpen(true)}
        >
          <Settings size={14} />
        </button>
      </div>
      <ResizeHandle axis="x" edge="end" onMouseDown={onMouseDown} />
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </div>
  );
}
```

`src/components/DiffViewer.tsx:34` — change:

```tsx
  const theme = useThemeStore((s) => s.theme);
```

to:

```tsx
  const theme = useThemeStore((s) => s.activeMode);
```

`src/index.css` — delete lines 5-22 and 24-41 (the two `:root[data-theme="..."] { ... }` blocks; colors are now applied at runtime by `applyTheme`). Change the `.label-pill` dark-mode selector (originally at lines 64-67) from:

```css
:root[data-theme="dark"] .label-pill {
  background: hsl(var(--label-h) 45% 22% / 1);
  color: hsl(var(--label-h) 65% 78%);
}
```

to:

```css
:root[data-theme-mode="dark"] .label-pill {
  background: hsl(var(--label-h) 45% 22% / 1);
  color: hsl(var(--label-h) 65% 78%);
}
```

Delete `src/components/ThemeToggle.tsx` and `src/__tests__/ThemeToggle.test.tsx` — no other file imports `ThemeToggle` after the `Sidebar.tsx` change above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run`
Expected: PASS — full suite green, including `Sidebar.test.tsx`, `DiffViewer.test.tsx`, `themeStore.test.ts`, `themes.test.ts`, `ThemeColorEditor.test.tsx`, `SettingsModal.test.tsx`. No leftover references to `ThemeToggle` anywhere (`grep -rn "ThemeToggle" src` returns nothing).

- [ ] **Step 5: Commit**

Skip (no git in this project).

---

## Manual verification (after Task 6)

Run `npm run dev`, open the app, and confirm:
1. Sidebar footer shows a gear icon instead of the sun/moon toggle.
2. Clicking it opens the settings modal with 5 preset swatches; clicking a preset changes the whole app's colors instantly.
3. Clicking the palette icon on a preset opens the color editor seeded from that preset's colors; changing a swatch live-updates the app behind the modal.
4. "Save as new" with a name creates a custom theme, closes back to the list, and the new custom theme now shows as active.
5. Reopening settings shows the custom theme under "Custom themes"; rename and delete both work.
6. Reloading the page (`Cmd+R` in the Tauri window, or refresh in `npm run dev` browser) keeps the previously active preset/custom theme.
7. Open a diff (any commit) and confirm syntax highlighting still switches correctly between a light preset (e.g. GitHub Light) and a dark one.
