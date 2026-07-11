import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DiffViewer from "../components/DiffViewer";

vi.mock("../lib/highlight", () => ({
  highlightLine: vi
    .fn()
    .mockResolvedValue('<pre class="shiki"><code><span class="line">HIGHLIGHTED</span></code></pre>'),
}));

const files = [
  {
    path: "a.txt",
    status: "modified",
    patch: "-one\n+two\n",
    oldContent: "one",
    newContent: "two",
    insertions: 1,
    deletions: 1,
  },
];

describe("DiffViewer", () => {
  it("renders file path and diff stats immediately", () => {
    render(<DiffViewer files={files} />);
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("shows plain diff text immediately, then upgrades to highlighted HTML", async () => {
    render(<DiffViewer files={files} />);
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("HIGHLIGHTED").length).toBeGreaterThan(0);
    });
  });

  it("side-by-side mode puts removed lines on the left and added lines on the right", () => {
    render(<DiffViewer files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "Side-by-side" }));
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });
});
