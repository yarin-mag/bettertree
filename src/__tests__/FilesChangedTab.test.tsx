import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { usePrDiffStore } from "../store/prDiffStore";

vi.mock("../lib/tauri", () => ({
  invokeGetPrDiff: vi.fn(),
  invokeListPrReviewComments: vi.fn(),
  invokeAddPrReviewComment: vi.fn(),
}));

import * as tauriLib from "../lib/tauri";
import FilesChangedTab from "../components/FilesChangedTab";

const sampleDiff = {
  baseOid: "b1",
  headOid: "h1",
  files: [
    {
      path: "src/common/SimpleQueue.js",
      status: "modified",
      insertions: 1,
      deletions: 1,
      lines: [
        { kind: "context", content: "  finally(() => {", oldLine: 113, newLine: 113 },
        { kind: "del", content: "  console.log('bug')", oldLine: 114, newLine: null },
        { kind: "add", content: "  // removed log", oldLine: null, newLine: 114 },
      ],
    },
  ],
};

describe("FilesChangedTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useGithubStore.setState({ selectedPrNumber: 42 });
    usePrDiffStore.setState({ diff: sampleDiff as any, reviewComments: [], isLoadingDiff: false });
  });

  it("renders each file's path and its lines", () => {
    render(<FilesChangedTab />);
    expect(screen.getByText("src/common/SimpleQueue.js")).toBeInTheDocument();
    expect(screen.getByText(/removed log/)).toBeInTheDocument();
  });

  it("renders an existing review comment anchored under its line", () => {
    usePrDiffStore.setState({
      reviewComments: [
        {
          id: 1,
          author: "avery",
          body: "why remove this?",
          createdAt: "2026-07-20T10:00:00Z",
          path: "src/common/SimpleQueue.js",
          line: 114,
          side: "RIGHT",
          url: "u",
        },
      ],
    });
    render(<FilesChangedTab />);
    expect(screen.getByText("why remove this?")).toBeInTheDocument();
  });

  it("opens a composer for a line, posts a comment, and shows it under that line", async () => {
    (tauriLib.invokeAddPrReviewComment as any).mockResolvedValue({
      id: 2,
      author: "yarinmag",
      body: "good catch",
      createdAt: "now",
      path: "src/common/SimpleQueue.js",
      line: 114,
      side: "RIGHT",
      url: "u",
    });
    render(<FilesChangedTab />);

    fireEvent.click(screen.getByRole("button", { name: "Comment on new line 114" }));
    fireEvent.change(screen.getByPlaceholderText("Leave a comment on this line"), {
      target: { value: "good catch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(tauriLib.invokeAddPrReviewComment).toHaveBeenCalledWith(
        "/tmp/a",
        42,
        "src/common/SimpleQueue.js",
        114,
        "RIGHT",
        "good catch"
      );
    });
    await waitFor(() => {
      expect(screen.getByText("good catch")).toBeInTheDocument();
    });
  });

  it("focuses the composer's textarea after opening it, so it's visible even when it opens off-screen", () => {
    render(<FilesChangedTab />);
    fireEvent.click(screen.getByRole("button", { name: "Comment on new line 114" }));
    expect(screen.getByPlaceholderText("Leave a comment on this line")).toHaveFocus();
  });

  it("only keeps one composer open at a time", () => {
    render(<FilesChangedTab />);
    fireEvent.click(screen.getByRole("button", { name: "Comment on new line 113" }));
    expect(screen.getByPlaceholderText("Leave a comment on this line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Comment on new line 114" }));
    expect(screen.getAllByPlaceholderText("Leave a comment on this line")).toHaveLength(1);
  });

  it("clicking a file header collapses and re-expands its lines", () => {
    render(<FilesChangedTab />);
    expect(screen.getByText(/removed log/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /src\/common\/SimpleQueue\.js/ }));
    expect(screen.queryByText(/removed log/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /src\/common\/SimpleQueue\.js/ }));
    expect(screen.getByText(/removed log/)).toBeInTheDocument();
  });

  it("collapses large files (over 200 lines) by default", () => {
    const bigFile = {
      path: "docs/generated.md",
      status: "added",
      insertions: 300,
      deletions: 0,
      lines: Array.from({ length: 300 }, (_, i) => ({
        kind: "add",
        content: `generated line ${i}`,
        oldLine: null,
        newLine: i + 1,
      })),
    };
    usePrDiffStore.setState({ diff: { baseOid: "b1", headOid: "h1", files: [bigFile] } as any });

    render(<FilesChangedTab />);

    expect(screen.getByText("docs/generated.md")).toBeInTheDocument();
    expect(screen.queryByText("generated line 0")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /docs\/generated\.md/ }));
    expect(screen.getByText("generated line 0")).toBeInTheDocument();
  });

  it("shows a Unified/Side-by-side toggle, defaulting to Unified", () => {
    render(<FilesChangedTab />);
    expect(screen.getByRole("button", { name: "Unified" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Side-by-side" })).toBeInTheDocument();
  });

  it("Side-by-side mode splits old/new content into separate panes without duplicating comment targets", () => {
    render(<FilesChangedTab />);
    fireEvent.click(screen.getByRole("button", { name: "Side-by-side" }));

    expect(screen.getAllByText(/finally/)).toHaveLength(2);
    expect(screen.getAllByText(/console\.log\('bug'\)/)).toHaveLength(1);
    expect(screen.getAllByText(/removed log/)).toHaveLength(1);

    expect(screen.getAllByRole("button", { name: "Comment on new line 113" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Comment on old line 114" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Comment on new line 114" })).toHaveLength(1);
  });

  describe("find (Cmd+F / Ctrl+F)", () => {
    const twoFileDiff = {
      baseOid: "b1",
      headOid: "h1",
      files: [
        {
          path: "src/common/SimpleQueue.js",
          status: "modified",
          insertions: 1,
          deletions: 1,
          lines: [
            { kind: "context", content: "  finally(() => {", oldLine: 113, newLine: 113 },
            { kind: "add", content: "  const enqueueJob = doThing();", oldLine: null, newLine: 114 },
          ],
        },
        {
          path: "src/common/OtherFile.js",
          status: "modified",
          insertions: 1,
          deletions: 0,
          lines: [{ kind: "add", content: "  const unrelated = 1;", oldLine: null, newLine: 1 }],
        },
      ],
    };

    beforeEach(() => {
      usePrDiffStore.setState({ diff: twoFileDiff as any, reviewComments: [], isLoadingDiff: false });
    });

    it("opens and focuses the search bar on Cmd+F / Ctrl+F", () => {
      render(<FilesChangedTab />);
      fireEvent.keyDown(window, { key: "f", metaKey: true });

      const input = screen.getByPlaceholderText("Search files or code…");
      expect(input).toBeInTheDocument();
      expect(document.activeElement).toBe(input);
    });

    it("filters to matching lines/files by code content, hiding unrelated files and lines", () => {
      render(<FilesChangedTab />);
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
      fireEvent.change(screen.getByPlaceholderText("Search files or code…"), { target: { value: "enqueueJob" } });

      expect(screen.getByText(/enqueueJob/)).toBeInTheDocument();
      expect(screen.queryByText(/finally/)).not.toBeInTheDocument();
      expect(screen.queryByText("src/common/OtherFile.js")).not.toBeInTheDocument();
    });

    it("shows every line of a file when the query matches its path instead", () => {
      render(<FilesChangedTab />);
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      fireEvent.change(screen.getByPlaceholderText("Search files or code…"), { target: { value: "SimpleQueue" } });

      expect(screen.getByText(/finally/)).toBeInTheDocument();
      expect(screen.getByText(/enqueueJob/)).toBeInTheDocument();
    });

    it("Escape closes the search bar and restores the full view", () => {
      render(<FilesChangedTab />);
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      fireEvent.change(screen.getByPlaceholderText("Search files or code…"), { target: { value: "enqueueJob" } });
      expect(screen.queryByText("src/common/OtherFile.js")).not.toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape" });

      expect(screen.queryByPlaceholderText("Search files or code…")).not.toBeInTheDocument();
      expect(screen.getByText("src/common/OtherFile.js")).toBeInTheDocument();
      expect(screen.getByText(/finally/)).toBeInTheDocument();
    });

    it("still lets you collapse a file while searching", () => {
      render(<FilesChangedTab />);
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      fireEvent.change(screen.getByPlaceholderText("Search files or code…"), { target: { value: "enqueueJob" } });
      expect(screen.getByText(/enqueueJob/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /src\/common\/SimpleQueue\.js/ }));
      expect(screen.queryByText(/enqueueJob/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /src\/common\/SimpleQueue\.js/ }));
      expect(screen.getByText(/enqueueJob/)).toBeInTheDocument();
    });

    it("has a button to open search without the keyboard shortcut", () => {
      render(<FilesChangedTab />);
      expect(screen.queryByPlaceholderText("Search files or code…")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Search files or code" }));

      expect(screen.getByPlaceholderText("Search files or code…")).toBeInTheDocument();
    });

    it("shows a match counter and Find next/previous cycle through matches", () => {
      const manyMatchesDiff = {
        baseOid: "b1",
        headOid: "h1",
        files: [
          {
            path: "src/a.js",
            status: "modified",
            insertions: 2,
            deletions: 0,
            lines: [
              { kind: "add", content: "const target = 1;", oldLine: null, newLine: 1 },
              { kind: "add", content: "const target2 = 2;", oldLine: null, newLine: 2 },
            ],
          },
        ],
      };
      usePrDiffStore.setState({ diff: manyMatchesDiff as any });

      render(<FilesChangedTab />);
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      fireEvent.change(screen.getByPlaceholderText("Search files or code…"), { target: { value: "target" } });

      expect(screen.getByText("1 of 2")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Find next" }));
      expect(screen.getByText("2 of 2")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Find next" }));
      expect(screen.getByText("1 of 2")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Find previous" }));
      expect(screen.getByText("2 of 2")).toBeInTheDocument();
    });
  });
});
