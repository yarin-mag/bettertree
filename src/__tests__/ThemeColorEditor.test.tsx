import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../lib/tauri", () => ({
  invokeWriteSettings: vi.fn().mockResolvedValue(undefined),
}));

import { useThemeStore } from "../store/themeStore";
import ThemeColorEditor from "../components/ThemeColorEditor";

describe("ThemeColorEditor", () => {
  beforeEach(() => {
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
