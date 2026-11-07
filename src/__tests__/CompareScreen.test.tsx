import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useCompareStore } from "../store/compareStore";
import { useBranchScopeStore } from "../store/branchScopeStore";

vi.mock("../lib/tauri", () => ({
  invokeCompareRefs: vi.fn(),
}));
vi.mock("../components/CompareTable", () => ({ default: () => <div data-testid="compare-table" /> }));
vi.mock("../components/CompareGraph", () => ({ default: () => <div data-testid="compare-graph" /> }));
vi.mock("../components/CompareTimeline", () => ({ default: () => <div data-testid="compare-timeline" /> }));

import * as tauriLib from "../lib/tauri";
import CompareScreen from "../components/CompareScreen";

const sampleResult = {
  baseOid: "b",
  compareOid: "c",
  mergeBaseOid: "m",
  onlyInBase: [],
  onlyInCompare: [{ oid: "c1", summary: "new work", author: "a", timestamp: 100 }],
  graph: [],
};

describe("CompareScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "abc" }],
      tags: [{ name: "v1.0.0", targetOid: "abc" }],
    });
    useCompareStore.setState({ baseRef: null, compareRef: null, result: null, isLoading: false, error: null });
    useBranchScopeStore.setState({ showRemoteBranches: true });
  });

  it("shows a prompt to pick two refs before anything is selected", () => {
    render(<CompareScreen />);
    expect(screen.getByText("Pick two refs to compare")).toBeInTheDocument();
  });

  it("renders the base and compare ref pickers", () => {
    render(<CompareScreen />);
    expect(screen.getByRole("button", { name: "Base ref" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare ref" })).toBeInTheDocument();
  });

  it("shows a loading state while the comparison is in flight", () => {
    (tauriLib.invokeCompareRefs as any).mockReturnValue(new Promise(() => {}));
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main" });
    render(<CompareScreen />);
    expect(screen.getByText("Comparing…")).toBeInTheDocument();
  });

  it("shows an error message when the comparison fails", async () => {
    (tauriLib.invokeCompareRefs as any).mockRejectedValue("ref 'x' not found");
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main" });
    render(<CompareScreen />);
    await waitFor(() => {
      expect(screen.getByText("ref 'x' not found")).toBeInTheDocument();
    });
  });

  it("shows an identical-refs empty state when both result lists are empty", async () => {
    (tauriLib.invokeCompareRefs as any).mockResolvedValue({
      baseOid: "b",
      compareOid: "b",
      mergeBaseOid: "b",
      onlyInBase: [],
      onlyInCompare: [],
      graph: [],
    });
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main" });
    render(<CompareScreen />);
    await waitFor(() => {
      expect(screen.getByText("No differences")).toBeInTheDocument();
    });
  });

  it("renders the Table view by default once a result is loaded", async () => {
    (tauriLib.invokeCompareRefs as any).mockResolvedValue(sampleResult);
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main" });
    render(<CompareScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("compare-table")).toBeInTheDocument();
    });
  });

  it("switches to the Graph view when the Graph button is clicked", async () => {
    (tauriLib.invokeCompareRefs as any).mockResolvedValue(sampleResult);
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main" });
    render(<CompareScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("compare-table")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(screen.getByTestId("compare-graph")).toBeInTheDocument();
    expect(screen.queryByTestId("compare-table")).not.toBeInTheDocument();
  });

  it("switches to the Timeline view when the Timeline button is clicked", async () => {
    (tauriLib.invokeCompareRefs as any).mockResolvedValue(sampleResult);
    useCompareStore.setState({ baseRef: "v1.0.0", compareRef: "main" });
    render(<CompareScreen />);
    await waitFor(() => {
      expect(screen.getByTestId("compare-table")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(screen.getByTestId("compare-timeline")).toBeInTheDocument();
  });

  it("excludes remote branches from the ref pickers when showRemoteBranches is false", () => {
    useBranchScopeStore.setState({ showRemoteBranches: false });
    useWorkspaceStore.setState({
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "a" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
      ],
    });
    render(<CompareScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText("origin/main")).not.toBeInTheDocument();
  });

  it("includes remote branches in the ref pickers when showRemoteBranches is true", () => {
    useBranchScopeStore.setState({ showRemoteBranches: true });
    useWorkspaceStore.setState({
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "a" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
      ],
    });
    render(<CompareScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
  });
});
