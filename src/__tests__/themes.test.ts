import { describe, it, expect, beforeEach } from "vitest";
import { PRESET_THEMES, isDarkColor, hexToRgba, applyTheme, applyUiFontSize, diffViewCssVars } from "../lib/themes";

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

  it("applyUiFontSize sets the --font-size-xs CSS var", () => {
    applyUiFontSize(16);
    expect(document.documentElement.style.getPropertyValue("--font-size-xs")).toBe("16px");
  });

  it("diffViewCssVars sets only the diff font size var when there are no overrides", () => {
    expect(diffViewCssVars(18, null)).toEqual({ "--font-size-sm": "18px" });
  });

  it("diffViewCssVars maps override color keys to their CSS vars", () => {
    expect(diffViewCssVars(14, { accent: "#ff00ff", canvas: "#000000" })).toEqual({
      "--font-size-sm": "14px",
      "--accent": "#ff00ff",
      "--bg-canvas": "#000000",
    });
  });
});
