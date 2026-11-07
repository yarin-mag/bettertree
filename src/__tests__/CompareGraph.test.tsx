import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareGraph from "../components/CompareGraph";

const result = {
  baseOid: "b",
  compareOid: "c",
  mergeBaseOid: "m",
  onlyInBase: [{ oid: "b1", summary: "old-side commit", author: "avery", timestamp: 100 }],
  onlyInCompare: [{ oid: "c1", summary: "new-side commit", author: "yarinmag", timestamp: 200 }],
  graph: [
    { oid: "c1", summary: "new-side commit", author: "yarinmag", timestamp: 200, lane: 1, edges: [], activeLanes: [true, true] },
    { oid: "b1", summary: "old-side commit", author: "avery", timestamp: 100, lane: 0, edges: [], activeLanes: [true, false] },
  ],
};

describe("CompareGraph", () => {
  it("renders every commit in the combined graph when direction is both", () => {
    render(<CompareGraph result={result as any} direction="both" />);
    expect(screen.getAllByTestId("commit-row")).toHaveLength(2);
    expect(screen.getByText("new-side commit")).toBeInTheDocument();
    expect(screen.getByText("old-side commit")).toBeInTheDocument();
  });

  it("only renders compare-side commits when direction is new-only", () => {
    render(<CompareGraph result={result as any} direction="new-only" />);
    expect(screen.getAllByTestId("commit-row")).toHaveLength(1);
    expect(screen.getByText("new-side commit")).toBeInTheDocument();
    expect(screen.queryByText("old-side commit")).not.toBeInTheDocument();
  });
});
