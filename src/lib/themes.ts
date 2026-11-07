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
export type ActiveThemeRef = { type: "preset" | "custom"; id: string };

export const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
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

function mixHex(from: string, to: string, amount: number): string {
  const parse = (hex: string) => {
    const n = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(n.substring(i, i + 2), 16));
  };
  const a = parse(from);
  const b = parse(to);
  const out = a.map((c, i) => Math.round(c + (b[i] - c) * amount));
  return `#${out.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// Dark themes often pick a yellowish "success" (Nord, Solarized) that turns
// muddy as a translucent diff background, so dark diffs pull it toward a true
// green. Light themes keep the plain success/danger tints.
const DIFF_TRUE_GREEN = "#2ea043";
const DIFF_GREEN_PULL = 0.6;
const DIFF_DARK_LINE_ALPHA = 0.22;
const DIFF_DARK_WORD_ALPHA = 0.5;

function applyDiffColors(colors: ThemeColors, dark: boolean): void {
  const root = document.documentElement.style;
  if (!dark) {
    root.setProperty("--diff-add-bg", hexToRgba(colors.success, SOFT_ALPHA));
    root.setProperty("--diff-del-bg", hexToRgba(colors.danger, SOFT_ALPHA));
    root.setProperty("--diff-add-word", `color-mix(in srgb, ${colors.success} 45%, transparent)`);
    root.setProperty("--diff-del-word", `color-mix(in srgb, ${colors.danger} 45%, transparent)`);
    return;
  }
  const add = mixHex(colors.success, DIFF_TRUE_GREEN, DIFF_GREEN_PULL);
  root.setProperty("--diff-add-bg", hexToRgba(add, DIFF_DARK_LINE_ALPHA));
  root.setProperty("--diff-del-bg", hexToRgba(colors.danger, DIFF_DARK_LINE_ALPHA));
  root.setProperty("--diff-add-word", hexToRgba(add, DIFF_DARK_WORD_ALPHA));
  root.setProperty("--diff-del-word", hexToRgba(colors.danger, DIFF_DARK_WORD_ALPHA));
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
  applyDiffColors(colors, mode === "dark");
  document.documentElement.dataset.themeMode = mode;
  return mode;
}

export function applyUiFontSize(px: number): void {
  document.documentElement.style.setProperty("--font-size-xs", `${px}px`);
}

export function diffViewCssVars(
  diffFontSizePx: number,
  overrides: Partial<ThemeColors> | null
): Record<string, string> {
  const vars: Record<string, string> = { "--font-size-sm": `${diffFontSizePx}px` };
  if (overrides) {
    (Object.keys(overrides) as Array<keyof ThemeColors>).forEach((key) => {
      const value = overrides[key];
      if (value) vars[CSS_VAR_MAP[key]] = value;
    });
  }
  return vars;
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
