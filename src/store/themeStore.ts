import { create } from "zustand";
import {
  PRESET_THEMES,
  applyTheme,
  applyUiFontSize,
  type ThemeColors,
  type CustomTheme,
  type ActiveThemeRef,
} from "../lib/themes";
import { invokeWriteSettings, type Settings } from "../lib/tauri";

const DEFAULT_PRESET_ID = "github-dark";

type ActiveRef = ActiveThemeRef;

interface FontSizeSettings {
  ui: number;
  diffView: number;
}

interface ThemeState {
  activeRef: ActiveRef;
  activeColors: ThemeColors;
  activeMode: "dark" | "light";
  customThemes: CustomTheme[];
  draft: ThemeColors | null;
  draftSourceId: string | null;
  fontSize: FontSizeSettings;
  diffViewTheme: Partial<ThemeColors> | null;

  selectPreset: (id: string) => void;
  selectCustom: (id: string) => void;
  startCustomizing: (sourceId: string, sourceType: "preset" | "custom") => void;
  updateDraftColor: (key: keyof ThemeColors, hex: string) => void;
  saveDraftAs: (name: string) => void;
  updateExistingCustom: () => void;
  cancelDraft: () => void;
  deleteCustomTheme: (id: string) => void;
  renameCustomTheme: (id: string, name: string) => void;
  setUiFontSize: (px: number) => void;
  setDiffViewFontSize: (px: number) => void;
  zoomFontSize: (delta: number) => void;
  setDiffViewColor: (key: keyof ThemeColors, hex: string | null) => void;
  applySettings: (settings: Settings) => void;
}

const DEFAULT_FONT_SIZE: FontSizeSettings = { ui: 12, diffView: 14 };
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 24;

function clampFontSize(px: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, px));
}

function defaultColors(): ThemeColors {
  return PRESET_THEMES.find((p) => p.id === DEFAULT_PRESET_ID)!.colors;
}

function resolveValidRef(ref: ActiveRef, customThemes: CustomTheme[]): ActiveRef {
  if (!ref || (ref.type !== "preset" && ref.type !== "custom") || typeof ref.id !== "string") {
    return { type: "preset", id: DEFAULT_PRESET_ID };
  }
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
  const activeRef: ActiveRef = { type: "preset", id: DEFAULT_PRESET_ID };
  const activeColors = defaultColors();
  const activeMode = applyTheme(activeColors);
  applyUiFontSize(DEFAULT_FONT_SIZE.ui);
  return { activeRef, activeColors, activeMode, customThemes: [] as CustomTheme[], fontSize: DEFAULT_FONT_SIZE };
}

function persist(state: Pick<ThemeState, "activeRef" | "customThemes" | "fontSize" | "diffViewTheme">) {
  const settings: Settings = {
    theme: { active: state.activeRef, customThemes: state.customThemes },
    fontSize: state.fontSize,
    diffViewTheme: state.diffViewTheme,
  };
  invokeWriteSettings(settings).catch((e) => console.warn("failed to persist settings.json", e));
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...buildInitialState(),
  draft: null,
  draftSourceId: null,
  diffViewTheme: null,

  selectPreset: (id) => {
    const preset = PRESET_THEMES.find((p) => p.id === id);
    if (!preset) return;
    const ref: ActiveRef = { type: "preset", id };
    const mode = applyTheme(preset.colors);
    set({ activeRef: ref, activeColors: preset.colors, activeMode: mode, draft: null, draftSourceId: null });
    persist(get());
  },

  selectCustom: (id) => {
    const custom = get().customThemes.find((c) => c.id === id);
    if (!custom) return;
    const ref: ActiveRef = { type: "custom", id };
    const mode = applyTheme(custom.colors);
    set({ activeRef: ref, activeColors: custom.colors, activeMode: mode, draft: null, draftSourceId: null });
    persist(get());
  },

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
    const ref: ActiveRef = { type: "custom", id };
    const mode = applyTheme(draft);
    set({ customThemes, activeRef: ref, activeColors: draft, activeMode: mode, draft: null, draftSourceId: null });
    persist(get());
  },

  updateExistingCustom: () => {
    const { draft, draftSourceId, customThemes } = get();
    if (!draft || !draftSourceId) return;
    const updated = customThemes.map((c) => (c.id === draftSourceId ? { ...c, colors: draft } : c));
    const ref: ActiveRef = { type: "custom", id: draftSourceId };
    const mode = applyTheme(draft);
    set({ customThemes: updated, activeRef: ref, activeColors: draft, activeMode: mode, draft: null, draftSourceId: null });
    persist(get());
  },

  cancelDraft: () => {
    applyTheme(get().activeColors);
    set({ draft: null, draftSourceId: null });
  },

  deleteCustomTheme: (id) => {
    const { customThemes, activeRef } = get();
    const remaining = customThemes.filter((c) => c.id !== id);
    if (activeRef.type === "custom" && activeRef.id === id) {
      const fallback = defaultColors();
      const ref: ActiveRef = { type: "preset", id: DEFAULT_PRESET_ID };
      const mode = applyTheme(fallback);
      set({ customThemes: remaining, activeRef: ref, activeColors: fallback, activeMode: mode });
    } else {
      set({ customThemes: remaining });
    }
    persist(get());
  },

  renameCustomTheme: (id, name) => {
    const updated = get().customThemes.map((c) => (c.id === id ? { ...c, name } : c));
    set({ customThemes: updated });
    persist(get());
  },

  setUiFontSize: (px) => {
    applyUiFontSize(px);
    set((state) => ({ fontSize: { ...state.fontSize, ui: px } }));
    persist(get());
  },

  setDiffViewFontSize: (px) => {
    set((state) => ({ fontSize: { ...state.fontSize, diffView: px } }));
    persist(get());
  },

  zoomFontSize: (delta) => {
    set((state) => {
      const fontSize = {
        ui: clampFontSize(state.fontSize.ui + delta),
        diffView: clampFontSize(state.fontSize.diffView + delta),
      };
      applyUiFontSize(fontSize.ui);
      return { fontSize };
    });
    persist(get());
  },

  setDiffViewColor: (key, hex) => {
    set((state) => {
      const next = { ...(state.diffViewTheme ?? {}) };
      if (hex) next[key] = hex;
      else delete next[key];
      return { diffViewTheme: Object.keys(next).length > 0 ? next : null };
    });
    persist(get());
  },

  applySettings: (settings) => {
    const activeRef = resolveValidRef(settings.theme.active, settings.theme.customThemes);
    const activeColors = resolveColors(activeRef, settings.theme.customThemes);
    const mode = applyTheme(activeColors);
    applyUiFontSize(settings.fontSize.ui);
    set({
      activeRef,
      customThemes: settings.theme.customThemes,
      activeColors,
      activeMode: mode,
      fontSize: settings.fontSize,
      diffViewTheme: settings.diffViewTheme,
    });
  },
}));
