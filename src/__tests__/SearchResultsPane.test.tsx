import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSearchStore } from "../store/searchStore";
import { useUiStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";

vi.mock("../lib/tauri", () => ({
  invokeSearchCommits: vi.fn(),
}));

import SearchResultsPane from "../components/SearchResultsPane";

describe("SearchResultsPane", () => {
  beforeEach(() => {
    useSearchStore.setState({
      historyQuery: "",
      authorFilter: "",
      sinceFilter: "",
      untilFilter: "",
      commitIdFilter: "",
      filePathFilter: "",
      advancedResults: [],
      isSearching: false,
      isSearchActive: true,
    });
    useUiStore.setState({ selectedCommitOid: null, isLoadingCommit: false });
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
  });

  it("renders the search input fields for filtering", () => {
    render(<SearchResultsPane />);
    expect(screen.getByPlaceholderText("Message or code...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Commit SHA...")).toBeInTheDocument();
  });

  it("renders each search hit", () => {
    useSearchStore.setState({
      advancedResults: [
        { oid: "c1", summary: "first commit", author: "Test User", timestamp: 100, snippet: "...one..." },
        { oid: "c2", summary: "second commit", author: "Test User", timestamp: 200, snippet: "...two..." },
      ],
    });
    render(<SearchResultsPane />);
    expect(screen.getAllByTestId("search-result-hit")).toHaveLength(2);
    expect(screen.getByText("first commit")).toBeInTheDocument();
    expect(screen.getByText("second commit")).toBeInTheDocument();
  });

  it("clicking a hit selects the commit and exits search view", () => {
    useSearchStore.setState({
      advancedResults: [
        { oid: "c1", summary: "first commit", author: "Test User", timestamp: 100, snippet: "...one..." },
      ],
    });
    render(<SearchResultsPane />);
    fireEvent.click(screen.getByText("first commit"));
    expect(useUiStore.getState().selectedCommitOid).toBe("c1");
    expect(useSearchStore.getState().isSearchActive).toBe(false);
  });

  it("shows a loading state while searching", () => {
    useSearchStore.setState({ isSearching: true });
    render(<SearchResultsPane />);
    expect(screen.getByText("Loading results...")).toBeInTheDocument();
  });

  it("shows an empty state when there are no results", () => {
    render(<SearchResultsPane />);
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});

describe("SearchResultsPane highlighting", () => {
  it("marks the matched query text in hits", () => {
    useSearchStore.setState({
      historyQuery: "First",
      isSearchActive: true,
      advancedResults: [
        { oid: "c1", summary: "first commit", author: "Test User", timestamp: 100, snippet: "...one..." },
      ],
    });
    const { container } = render(<SearchResultsPane />);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("first");
  });
});
