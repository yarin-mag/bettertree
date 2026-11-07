import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useGlobalShortcuts, useShortcut, useShortcutsDialogStore } from "../hooks/useKeyboardShortcuts";
import ShortcutsDialog from "../components/ShortcutsDialog";
import { useUiStore } from "../store/uiStore";

function Harness({ onKey }: { onKey?: () => void }) {
  useGlobalShortcuts();
  useShortcut({ id: "t.key", keys: ["x"], display: "x", description: "Test action", group: "Test" }, () => onKey?.());
  return (
    <>
      <input placeholder="Search branches, tags, commits..." />
      <ShortcutsDialog />
    </>
  );
}

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    useShortcutsDialogStore.setState({ open: false });
    useUiStore.setState({ selectedCommitOid: null });
  });

  it("'/' focuses the search input", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Search branches, tags, commits..."));
  });

  it("ignores shortcuts while typing in an input", () => {
    const onKey = vi.fn();
    render(<Harness onKey={onKey} />);
    screen.getByPlaceholderText("Search branches, tags, commits...").focus();
    fireEvent.keyDown(window, { key: "x" });
    expect(onKey).not.toHaveBeenCalled();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { key: "x" });
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it("ignores keys pressed with a modifier", () => {
    const onKey = vi.fn();
    render(<Harness onKey={onKey} />);
    fireEvent.keyDown(window, { key: "x", metaKey: true });
    expect(onKey).not.toHaveBeenCalled();
  });

  it("'?' opens a dialog listing bound and documented shortcuts; Esc closes it", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("Test action")).toBeInTheDocument();
    expect(screen.getByText("Next diff hunk")).toBeInTheDocument();
    expect(screen.getByText("Zoom in")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stops listing a shortcut once its component unmounts", () => {
    const { unmount } = render(<Harness />);
    unmount();
    function Only() {
      return <ShortcutsDialog />;
    }
    render(<Only />);
    act(() => useShortcutsDialogStore.getState().setOpen(true));
    expect(screen.queryByText("Test action")).not.toBeInTheDocument();
  });

  it("Esc closes the commit drawer", () => {
    useUiStore.setState({ selectedCommitOid: "abc" });
    render(<Harness />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().selectedCommitOid).toBeNull();
  });
});
