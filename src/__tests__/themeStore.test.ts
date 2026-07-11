import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore } from "../store/themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useThemeStore.setState({ theme: "dark" });
  });

  it("toggleTheme flips dark to light and back", () => {
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("toggleTheme sets the data-theme attribute on <html>", () => {
    useThemeStore.getState().toggleTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("toggleTheme persists the choice to localStorage", () => {
    useThemeStore.getState().toggleTheme();
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
