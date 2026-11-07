import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeWriteSettings: vi.fn().mockResolvedValue(undefined),
}));

import { useThemeStore } from "../store/themeStore";
import * as tauriLib from "../lib/tauri";

describe("themeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme-mode");
    useThemeStore.setState({
      customThemes: [],
      draft: null,
      draftSourceId: null,
      fontSize: { ui: 12, diffView: 14 },
      diffViewTheme: null,
    });
    useThemeStore.getState().selectPreset("github-dark");
    vi.clearAllMocks();
  });

  it("selectPreset applies colors, updates state, and persists via write_settings", () => {
    useThemeStore.getState().selectPreset("dracula");
    const state = useThemeStore.getState();
    expect(state.activeRef).toEqual({ type: "preset", id: "dracula" });
    expect(state.activeColors.canvas).toBe("#282a36");
    expect(state.activeMode).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--bg-canvas")).toBe("#282a36");
    expect(tauriLib.invokeWriteSettings).toHaveBeenCalledWith({
      theme: { active: { type: "preset", id: "dracula" }, customThemes: [] },
      fontSize: { ui: 12, diffView: 14 },
      diffViewTheme: null,
    });
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

  it("applySettings falls back to github-dark when active references a missing custom theme", () => {
    useThemeStore.getState().applySettings({
      theme: { active: { type: "custom", id: "missing" }, customThemes: [] },
      fontSize: { ui: 12, diffView: 14 },
      diffViewTheme: null,
    });
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
  });

  it("applySettings falls back to github-dark when active references an unknown preset id", () => {
    useThemeStore.getState().applySettings({
      theme: { active: { type: "preset", id: "not-a-real-preset" }, customThemes: [] },
      fontSize: { ui: 12, diffView: 14 },
      diffViewTheme: null,
    });
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
  });

  it("applySettings adopts fontSize and diffViewTheme from the payload", () => {
    useThemeStore.getState().applySettings({
      theme: { active: { type: "preset", id: "nord" }, customThemes: [] },
      fontSize: { ui: 16, diffView: 20 },
      diffViewTheme: { accent: "#ff00ff" },
    });
    const state = useThemeStore.getState();
    expect(state.fontSize).toEqual({ ui: 16, diffView: 20 });
    expect(state.diffViewTheme).toEqual({ accent: "#ff00ff" });
    expect(document.documentElement.style.getPropertyValue("--font-size-xs")).toBe("16px");
  });
});

describe("themeStore draft + custom CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ customThemes: [], fontSize: { ui: 12, diffView: 14 }, diffViewTheme: null });
    useThemeStore.getState().selectPreset("github-dark");
    vi.clearAllMocks();
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
    expect(tauriLib.invokeWriteSettings).not.toHaveBeenCalled();
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
    expect(tauriLib.invokeWriteSettings).toHaveBeenCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ customThemes: state.customThemes }) })
    );
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
    expect(state.customThemes[0].colors.danger).toBe("#123456");
    expect(state.activeRef).toEqual({ type: "custom", id });
  });

  it("deleteCustomTheme falls back to github-dark when deleting the active custom theme", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("Mine");
    const id = useThemeStore.getState().customThemes[0].id;
    useThemeStore.getState().deleteCustomTheme(id);
    expect(useThemeStore.getState().customThemes).toHaveLength(0);
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
  });

  it("renameCustomTheme updates the name and persists", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("Mine");
    const id = useThemeStore.getState().customThemes[0].id;
    useThemeStore.getState().renameCustomTheme(id, "Renamed");
    expect(useThemeStore.getState().customThemes[0].name).toBe("Renamed");
  });
});

describe("themeStore font size + diff view overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ fontSize: { ui: 12, diffView: 14 }, diffViewTheme: null });
  });

  it("setUiFontSize updates state, the CSS var, and persists", () => {
    useThemeStore.getState().setUiFontSize(18);
    expect(useThemeStore.getState().fontSize.ui).toBe(18);
    expect(document.documentElement.style.getPropertyValue("--font-size-xs")).toBe("18px");
    expect(tauriLib.invokeWriteSettings).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: { ui: 18, diffView: 14 } })
    );
  });

  it("setDiffViewFontSize updates only the diffView field", () => {
    useThemeStore.getState().setDiffViewFontSize(22);
    expect(useThemeStore.getState().fontSize).toEqual({ ui: 12, diffView: 22 });
  });

  it("setDiffViewColor sets an override key", () => {
    useThemeStore.getState().setDiffViewColor("accent", "#123123");
    expect(useThemeStore.getState().diffViewTheme).toEqual({ accent: "#123123" });
  });

  it("setDiffViewColor with null clears an override key, resetting to null when it was the last one", () => {
    useThemeStore.getState().setDiffViewColor("accent", "#123123");
    useThemeStore.getState().setDiffViewColor("accent", null);
    expect(useThemeStore.getState().diffViewTheme).toBeNull();
  });
});
