import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../lib/tauri", () => ({
  invokeWriteSettings: vi.fn().mockResolvedValue(undefined),
}));

import { useThemeStore } from "../store/themeStore";
import SettingsModal from "../components/SettingsModal";

describe("SettingsModal", () => {
  beforeEach(() => {
    useThemeStore.setState({
      customThemes: [],
      draft: null,
      draftSourceId: null,
      fontSize: { ui: 12, diffView: 14 },
      diffViewTheme: null,
    });
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

  it("shows current font size values and updates them", () => {
    render(<SettingsModal onClose={() => {}} />);
    const uiInput = screen.getByLabelText("App UI font size") as HTMLInputElement;
    expect(uiInput.value).toBe("12");
    fireEvent.change(uiInput, { target: { value: "18" } });
    expect(useThemeStore.getState().fontSize.ui).toBe(18);
  });

  it("lets you set and reset a diff-view color override", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Accent override"), { target: { value: "#123123" } });
    expect(useThemeStore.getState().diffViewTheme).toEqual({ accent: "#123123" });
    fireEvent.click(screen.getByRole("button", { name: "Reset Accent override" }));
    expect(useThemeStore.getState().diffViewTheme).toBeNull();
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

describe("SettingsModal CI section", () => {
  beforeEach(async () => {
    localStorage.clear();
    const { useCiPrefsStore } = await import("../store/ciPrefsStore");
    const { useWorkspaceStore } = await import("../store/workspaceStore");
    useCiPrefsStore.setState({ prefs: {} } as any);
    useWorkspaceStore.setState({ repos: [{ id: 1, path: "/r", name: "r", pinned: false }], activeRepoId: 1 } as any);
  });

  it("toggles badgeFollowsFavorites for the active repo (default on)", async () => {
    const { useCiPrefsStore } = await import("../store/ciPrefsStore");
    render(<SettingsModal onClose={() => {}} />);
    const box = screen.getByLabelText("Badges follow favorite workflows") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(useCiPrefsStore.getState().getPrefs("/r").badgeFollowsFavorites).toBe(false);
    expect((screen.getByLabelText("Badges follow favorite workflows") as HTMLInputElement).checked).toBe(false);
  });

  it("is disabled with no active repo", async () => {
    const { useWorkspaceStore } = await import("../store/workspaceStore");
    useWorkspaceStore.setState({ repos: [], activeRepoId: null } as any);
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByLabelText("Badges follow favorite workflows")).toBeDisabled();
  });
});
