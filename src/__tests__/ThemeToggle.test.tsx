import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useThemeStore } from "../store/themeStore";
import ThemeToggle from "../components/ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: "dark" });
  });

  it("toggles the theme when clicked", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(useThemeStore.getState().theme).toBe("light");
  });
});
