import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../lib/highlight", () => ({ highlightLine: vi.fn().mockResolvedValue(null) }));

import DiffViewer from "../components/DiffViewer";
import { useDiffViewStore } from "../store/diffViewStore";

const files = [
  {
    path: "a.txt",
    status: "modified",
    patch: "-first second third one fourth fifth\n+first second third two fourth fifth\n context\n",
    oldContent: "",
    newContent: "",
    insertions: 1,
    deletions: 1,
  },
];

describe("diff view wrap preference", () => {
  beforeEach(() => {
    localStorage.clear();
    useDiffViewStore.setState({ mode: "unified", ignoreWhitespace: false, wrapLines: true });
  });

  it("wraps by default and the toolbar checkbox reflects it", () => {
    render(<DiffViewer files={files} />);
    expect(screen.getByLabelText("Wrap lines")).toBeChecked();
    expect(screen.getByText("one").parentElement!.className).toContain("whitespace-pre-wrap");
  });

  it("unchecking Wrap lines keeps each line on one row", () => {
    render(<DiffViewer files={files} />);
    fireEvent.click(screen.getByLabelText("Wrap lines"));
    expect(screen.getByLabelText("Wrap lines")).not.toBeChecked();
    const cls = screen.getByText("one").parentElement!.className;
    expect(cls).toContain("whitespace-pre");
    expect(cls).not.toContain("whitespace-pre-wrap");
  });

  it("remembers the choice across reloads", async () => {
    useDiffViewStore.getState().setWrapLines(false);
    expect(localStorage.getItem("bettertree.diff.wrapLines")).toBe("false");

    vi.resetModules();
    const fresh = await import("../store/diffViewStore");
    expect(fresh.useDiffViewStore.getState().wrapLines).toBe(false);
  });

  it("defaults to wrapping when nothing is stored or storage is unreadable", async () => {
    vi.resetModules();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const fresh = await import("../store/diffViewStore");
    expect(fresh.useDiffViewStore.getState().wrapLines).toBe(true);
    spy.mockRestore();
  });
});

describe("side-by-side layout", () => {
  beforeEach(() => {
    localStorage.clear();
    useDiffViewStore.setState({ mode: "split", ignoreWhitespace: false, wrapLines: true });
  });

  it("renders each old/new pair as neighbours in one grid so wrapped rows stay aligned", () => {
    render(<DiffViewer files={files} />);
    const grid = screen.getByTestId("split-grid");
    expect(grid.children[0]).toHaveTextContent("one");
    expect(grid.children[1]).toHaveTextContent("two");
    expect(grid.children[0]).not.toHaveTextContent("two");
  });

  it("without wrapping, both panes scroll together as one wide grid", () => {
    useDiffViewStore.setState({ wrapLines: false });
    render(<DiffViewer files={files} />);
    const grid = screen.getByTestId("split-grid");
    expect(grid.className).toContain("min-w-max");
    expect(grid.parentElement!.className).toContain("overflow-x-auto");
  });

  it("with wrapping, columns may shrink instead of overflowing", () => {
    render(<DiffViewer files={files} />);
    expect(screen.getByTestId("split-grid").className).not.toContain("min-w-max");
  });

  it("a folded run of unchanged lines spans both columns", () => {
    const context = Array.from({ length: 12 }, (_, i) => ` same ${i}`).join("\n");
    render(<DiffViewer files={[{ ...files[0], patch: `-a\n+b\n${context}\n` }]} />);
    const button = screen.getByRole("button", { name: /Show \d+ unchanged lines/ });
    expect(button.parentElement!.className).toContain("col-span-2");
  });
});
