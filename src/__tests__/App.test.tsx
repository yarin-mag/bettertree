import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock("../components/CommitGraph", () => ({ default: () => <div data-testid="commit-graph" /> }));
vi.mock("../components/SearchBar", () => ({ default: () => <div data-testid="search-bar" /> }));
vi.mock("../components/Toolbar", () => ({ default: () => <div data-testid="toolbar" /> }));
vi.mock("../components/CommitDrawer", () => ({ default: () => <div data-testid="commit-drawer" /> }));
vi.mock("../components/SearchResultsPane", () => ({
  default: () => <div data-testid="search-results-pane" />,
}));
vi.mock("../components/PullRequestsScreen", () => ({
  default: () => <div data-testid="pull-requests-screen" />,
}));
vi.mock("../components/ActionsScreen", () => ({ default: () => <div data-testid="actions-screen" /> }));
vi.mock("../components/CompareScreen", () => ({ default: () => <div data-testid="compare-screen" /> }));
vi.mock("../components/SettingsSync", () => ({ default: () => null }));

import { useSearchStore } from "../store/searchStore";
import { useViewStore } from "../store/viewStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import App from "../App";

describe("App", () => {
  beforeEach(() => {
    useSearchStore.setState({ isSearchActive: false });
    useViewStore.setState({ activeView: "repo" });
    useWorkspaceStore.setState({ activeRepoId: 1 });
  });

  it("shows a no-repository empty state instead of the graph when no repo is active", () => {
    useWorkspaceStore.setState({ activeRepoId: null });
    render(<App />);
    expect(screen.getByText("No repository selected")).toBeInTheDocument();
    expect(screen.queryByTestId("commit-graph")).not.toBeInTheDocument();
  });

  it("shows the Pull Requests screen instead of the repo view when activeView is pulls", () => {
    useViewStore.setState({ activeView: "pulls" });
    render(<App />);
    expect(screen.getByTestId("pull-requests-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("commit-graph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
  });

  it("shows the commit graph and drawer when search is inactive", () => {
    render(<App />);
    expect(screen.getByTestId("commit-graph")).toBeInTheDocument();
    expect(screen.getByTestId("commit-drawer")).toBeInTheDocument();
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
  });

  it("shows the search results pane instead when search is active", () => {
    useSearchStore.setState({ isSearchActive: true });
    render(<App />);
    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("commit-graph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("commit-drawer")).not.toBeInTheDocument();
  });

  it("shows the Actions screen without the search bar when activeView is actions", () => {
    useViewStore.setState({ activeView: "actions" });
    render(<App />);
    expect(screen.getByTestId("actions-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("commit-graph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-bar")).not.toBeInTheDocument();
  });

  it("hides the global search bar in the Pull Requests view", () => {
    useViewStore.setState({ activeView: "pulls" });
    render(<App />);
    expect(screen.queryByTestId("search-bar")).not.toBeInTheDocument();
  });

  it("shows the global search bar in the repo view", () => {
    render(<App />);
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
  });

  it("shows the Compare screen instead of the repo view when activeView is compare", () => {
    useViewStore.setState({ activeView: "compare" });
    render(<App />);
    expect(screen.getByTestId("compare-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("commit-graph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pull-requests-screen")).not.toBeInTheDocument();
  });

  it("hides the global search bar in the Compare view", () => {
    useViewStore.setState({ activeView: "compare" });
    render(<App />);
    expect(screen.queryByTestId("search-bar")).not.toBeInTheDocument();
  });
});
