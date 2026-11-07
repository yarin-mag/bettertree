import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("../lib/tauri", () => ({
  invokeGetSettings: vi.fn(),
  invokeWriteSettings: vi.fn().mockResolvedValue(undefined),
}));

import SettingsSync from "../components/SettingsSync";
import { useThemeStore } from "../store/themeStore";
import * as tauriLib from "../lib/tauri";

const SETTINGS_A = {
  theme: { active: { type: "preset" as const, id: "dracula" }, customThemes: [] },
  fontSize: { ui: 16, diffView: 20 },
  diffViewTheme: null,
};

describe("SettingsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenMock.mockResolvedValue(() => {});
    useThemeStore.getState().selectPreset("github-dark");
  });

  it("applies settings loaded from get_settings on mount", async () => {
    (tauriLib.invokeGetSettings as any).mockResolvedValue(SETTINGS_A);

    render(<SettingsSync />);

    await waitFor(() => expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "dracula" }));
    expect(useThemeStore.getState().fontSize).toEqual({ ui: 16, diffView: 20 });
  });

  it("subscribes to settings-changed and applies incoming payloads", async () => {
    (tauriLib.invokeGetSettings as any).mockResolvedValue(SETTINGS_A);
    let handler: (event: { payload: unknown }) => void = () => {};
    listenMock.mockImplementation((_name: string, cb: (event: { payload: unknown }) => void) => {
      handler = cb;
      return Promise.resolve(() => {});
    });

    render(<SettingsSync />);
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith("settings-changed", expect.any(Function)));

    const pushed = {
      theme: { active: { type: "preset", id: "nord" }, customThemes: [] },
      fontSize: { ui: 14, diffView: 16 },
      diffViewTheme: null,
    };
    handler({ payload: pushed });

    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "nord" });
    expect(useThemeStore.getState().fontSize).toEqual({ ui: 14, diffView: 16 });
  });
});
