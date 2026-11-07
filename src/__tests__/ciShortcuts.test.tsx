import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useUiStore } from "../store/uiStore";
import { useRegisteredShortcuts } from "../hooks/useKeyboardShortcuts";
import { useCiShortcuts } from "../components/ChecksPanel";

function Harness({ onFavoritesToggle, enabled = true }: { onFavoritesToggle: () => void; enabled?: boolean }) {
  useCiShortcuts({ enabled, onToggleFavoritesOnly: onFavoritesToggle });
  const shortcuts = useRegisteredShortcuts();
  return <ul>{shortcuts.map((s) => <li key={s.id}>{s.id}</li>)}</ul>;
}

describe("CI shortcuts", () => {
  it("'c' opens the Checks tab and 'f' toggles favorites-only, both registered for the help dialog", () => {
    useUiStore.setState({ drawerTab: "diff" } as any);
    const toggle = vi.fn();
    const { getByText } = render(<Harness onFavoritesToggle={toggle} />);
    expect(getByText("ci.open-checks")).toBeInTheDocument();
    expect(getByText("ci.favorites-only")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "c" });
    expect(useUiStore.getState().drawerTab).toBe("checks");
    fireEvent.keyDown(window, { key: "f" });
    expect(toggle).toHaveBeenCalled();
  });
  it("'f' does nothing unless the Checks tab is showing", () => {
    useUiStore.setState({ drawerTab: "diff" } as any);
    const toggle = vi.fn();
    render(<Harness onFavoritesToggle={toggle} />);
    fireEvent.keyDown(window, { key: "f" });
    expect(toggle).not.toHaveBeenCalled();
  });
  it("does nothing when disabled", () => {
    useUiStore.setState({ drawerTab: "diff" } as any);
    const toggle = vi.fn();
    render(<Harness onFavoritesToggle={toggle} enabled={false} />);
    fireEvent.keyDown(window, { key: "c" });
    expect(useUiStore.getState().drawerTab).toBe("diff");
  });
  it("ignores keys typed in inputs", () => {
    useUiStore.setState({ drawerTab: "diff" } as any);
    const { container } = render(<><input data-testid="i" /><Harness onFavoritesToggle={vi.fn()} /></>);
    (container.querySelector("input") as HTMLInputElement).focus();
    fireEvent.keyDown(window, { key: "c" });
    expect(useUiStore.getState().drawerTab).toBe("diff");
  });
});
