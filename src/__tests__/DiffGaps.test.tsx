import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/highlight", () => ({
  highlightLine: vi.fn().mockResolvedValue(null),
}));

import * as highlight from "../lib/highlight";
import DiffViewer from "../components/DiffViewer";
import { useDiffViewStore } from "../store/diffViewStore";

const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
lines[4] = "CHANGED 5";
lines[34] = "CHANGED 35";
const newContent = lines.join("\n") + "\n";
const patch =
  "@@ -4,3 +4,3 @@\n line 4\n-line 5\n+CHANGED 5\n line 6\n" +
  "@@ -34,3 +34,3 @@\n line 34\n-line 35\n+CHANGED 35\n line 36\n";

const files = [
  { path: "a.ts", status: "modified", patch, oldContent: "", newContent, insertions: 2, deletions: 2 },
];

describe("expandable hidden lines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(highlight.highlightLine).mockResolvedValue(null);
    useDiffViewStore.setState({ mode: "unified", ignoreWhitespace: false, wrapLines: true });
  });

  it("shows a row for the lines hidden before, between and after the changes", () => {
    render(<DiffViewer files={files} />);
    const rows = screen.getAllByTestId("diff-gap");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("3 hidden lines");
    expect(rows[1]).toHaveTextContent("27 hidden lines");
    expect(rows[2]).toHaveTextContent("4 hidden lines");
  });

  it("Show all reveals the lines in place and removes the row", () => {
    render(<DiffViewer files={files} />);
    expect(screen.queryByText("line 10")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all 27 hidden lines" }));

    expect(screen.getByText("line 7")).toBeInTheDocument();
    expect(screen.getByText("line 33")).toBeInTheDocument();
    expect(screen.getAllByTestId("diff-gap")).toHaveLength(2);
  });

  it("small gaps offer only Show all; big ones also offer 20-line steps", () => {
    render(<DiffViewer files={files} />);
    const [first, middle, last] = screen.getAllByTestId("diff-gap");
    expect(first.querySelectorAll("button")).toHaveLength(1);
    expect(last.querySelectorAll("button")).toHaveLength(1);
    expect(middle.querySelectorAll("button")).toHaveLength(3);
  });

  it("stepping down from the previous change reveals the next 20 lines there", () => {
    render(<DiffViewer files={files} />);

    fireEvent.click(screen.getByRole("button", { name: "Show next 20 lines" }));

    expect(screen.getByText("line 7")).toBeInTheDocument();
    expect(screen.getByText("line 26")).toBeInTheDocument();
    expect(screen.queryByText("line 27")).toBeNull();
    expect(screen.getByText("7 hidden lines")).toBeInTheDocument();
  });

  it("stepping up from the following change reveals the 20 lines before it", () => {
    render(<DiffViewer files={files} />);

    fireEvent.click(screen.getByRole("button", { name: "Show previous 20 lines" }));

    expect(screen.getByText("line 33")).toBeInTheDocument();
    expect(screen.getByText("line 14")).toBeInTheDocument();
    expect(screen.queryByText("line 13")).toBeNull();
  });

  it("the file's first gap only offers lines before the first change (no step needed when small)", () => {
    render(<DiffViewer files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 3 hidden lines" }));
    expect(screen.getByText("line 1")).toBeInTheDocument();
    expect(screen.getByText("line 3")).toBeInTheDocument();
  });

  it("shows no gap rows when the file contents are unavailable", () => {
    render(<DiffViewer files={[{ ...files[0], newContent: null }]} />);
    expect(screen.queryByTestId("diff-gap")).toBeNull();
  });

  it("revealed lines get syntax highlighting like the rest", async () => {
    vi.mocked(highlight.highlightLine).mockImplementation(async (content: string) =>
      content === "line 7" ? '<pre class="shiki"><code><span class="line">HL-SEVEN</span></code></pre>' : null
    );
    render(<DiffViewer files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 27 hidden lines" }));

    await waitFor(() => expect(screen.getByText("HL-SEVEN")).toBeInTheDocument());
  });

  it("in side-by-side mode the gap row spans both columns and revealed lines show on both sides", () => {
    useDiffViewStore.setState({ mode: "split" });
    render(<DiffViewer files={files} />);
    expect(screen.getAllByTestId("diff-gap")[1].parentElement!.className).toContain("col-span-2");

    fireEvent.click(screen.getByRole("button", { name: "Show all 27 hidden lines" }));

    expect(screen.getAllByText("line 20")).toHaveLength(2);
  });

  it("starts over when a different patch is shown", () => {
    const { rerender } = render(<DiffViewer files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 27 hidden lines" }));
    expect(screen.getAllByTestId("diff-gap")).toHaveLength(2);

    rerender(<DiffViewer files={[{ ...files[0], patch: patch + " ", newContent: newContent + "extra\n" }]} />);

    expect(screen.getAllByTestId("diff-gap").length).toBeGreaterThanOrEqual(3);
  });
});
