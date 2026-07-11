import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import CommitGraph from "../components/CommitGraph";

describe("CommitGraph", () => {
  beforeEach(() => {
    useSearchStore.setState({ query: "" });
    useWorkspaceStore.setState({
      commits: [
        {
          oid: "c2",
          summary: "second commit",
          author: "Test User",
          timestamp: 200,
          lane: 0,
          edges: [{ parentOid: "c1", parentLane: 0 }],
          activeLanes: [true],
        },
        {
          oid: "c1",
          summary: "first commit",
          author: "Test User",
          timestamp: 100,
          lane: 0,
          edges: [],
          activeLanes: [false],
        },
      ],
    });
  });

  it("renders one row per commit with its summary and lane", () => {
    render(<CommitGraph />);
    const rows = screen.getAllByTestId("commit-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("second commit")).toBeInTheDocument();
    expect(screen.getByText("first commit")).toBeInTheDocument();
  });

  it("positions each row's dot according to its lane", () => {
    render(<CommitGraph />);
    const dots = screen.getAllByTestId("commit-dot");
    expect(dots[0]).toHaveAttribute("cx", "12");
    expect(dots[1]).toHaveAttribute("cx", "12");
  });

  it("draws a curved connector for a merge commit with two different-lane edges", () => {
    useWorkspaceStore.setState({
      commits: [
        {
          oid: "m1",
          summary: "merge feature",
          author: "Test User",
          timestamp: 300,
          lane: 0,
          edges: [
            { parentOid: "c2", parentLane: 0 },
            { parentOid: "f1", parentLane: 1 },
          ],
          activeLanes: [true, true],
        },
      ],
    });
    render(<CommitGraph />);
    const paths = document.querySelectorAll("path");
    // One curved <path> for the cross-lane edge (lane 0 -> lane 1); the
    // same-lane edge (0 -> 0) is a straight line, not a path.
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a plain single-color dot when a search query is filtering the list", () => {
    useSearchStore.setState({ query: "second" });
    render(<CommitGraph />);
    const dot = screen.getByTestId("commit-dot");
    expect(dot).toHaveAttribute("fill", "var(--accent)");
    expect(dot).toHaveAttribute("cx", "12");
  });
});
