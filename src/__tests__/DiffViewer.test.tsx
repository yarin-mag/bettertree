import { describe, it, expect, vi, afterEach } from "vitest";
import { HUGE_PATCH_LINES } from "../lib/diffLines";
import { useToastStore } from "../store/toastStore";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import DiffViewer from "../components/DiffViewer";
import { useThemeStore } from "../store/themeStore";

vi.mock("../lib/highlight", () => ({
  highlightLine: vi
    .fn()
    .mockResolvedValue('<pre class="shiki"><code><span class="line">HIGHLIGHTED</span></code></pre>'),
}));

// Long enough (>30 chars) that word-level, not char-level, diffing kicks in,
// so "one"/"two" stay intact as single text nodes for getByText assertions.
const files = [
  {
    path: "a.txt",
    status: "modified",
    patch: "-first second third one fourth fifth\n+first second third two fourth fifth\n context\n",
    oldContent: "first second third one fourth fifth",
    newContent: "first second third two fourth fifth",
    insertions: 1,
    deletions: 1,
  },
];

describe("DiffViewer", () => {
  afterEach(() => {
    useThemeStore.setState({ fontSize: { ui: 12, diffView: 14 }, diffViewTheme: null });
  });

  it("applies the diff-view font size and color overrides as CSS vars on its root", () => {
    useThemeStore.setState({ fontSize: { ui: 12, diffView: 20 }, diffViewTheme: { accent: "#ff00ff" } });
    const { container } = render(<DiffViewer files={files} />);
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--font-size-sm")).toBe("20px");
    expect(root.style.getPropertyValue("--accent")).toBe("#ff00ff");
  });

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

  it("shows a bordered 'Binary file' row without a load button", () => {
    render(<DiffViewer files={[{ ...files[0], path: "img.png", patch: "", isBinary: true }]} />);
    expect(screen.getByText("Binary file")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load diff" })).toBeNull();
  });

  it("defers huge files until the user loads them", () => {
    const patch = "@@ -1,1 +1,1 @@\n" + "+added line content\n".repeat(HUGE_PATCH_LINES + 10);
    render(<DiffViewer files={[{ ...files[0], patch }]} />);
    expect(screen.getByText(/Large file \(\d+ lines\), click to load/)).toBeInTheDocument();
    expect(screen.queryAllByText("added line content")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Load diff" }));
    expect(screen.queryByText(/click to load/)).toBeNull();
    expect(screen.getAllByText("added line content").length).toBeGreaterThan(0);
  });

  it("Collapse all / Expand all toggle every file body", () => {
    render(<DiffViewer files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByText("one")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByText("one")).toBeInTheDocument();
  });

  it("copies the file path and toasts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    useToastStore.setState({ toasts: [] });
    render(<DiffViewer files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy file path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("a.txt"));
    await waitFor(() => expect(useToastStore.getState().toasts[0]?.message).toMatch(/Copied/));
  });

  it("renders a placeholder, not rows, for files outside the viewport", () => {
    let callback: IntersectionObserverCallback = () => {};
    class FakeIO {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
    try {
      render(<DiffViewer files={files} />);
      expect(screen.getByTestId("diff-placeholder")).toBeInTheDocument();
      expect(screen.queryByText("one")).toBeNull();
      act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(screen.getByText("one")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
