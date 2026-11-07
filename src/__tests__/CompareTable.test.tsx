import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareTable from "../components/CompareTable";

const result = {
  baseOid: "b",
  compareOid: "c",
  mergeBaseOid: "m",
  onlyInBase: [{ oid: "b1", summary: "old-side commit", author: "avery", timestamp: 100 }],
  onlyInCompare: [{ oid: "c1", summary: "new-side commit", author: "yarinmag", timestamp: 200 }],
  graph: [],
};

describe("CompareTable", () => {
  it("shows both sections and their commits when direction is both", () => {
    render(<CompareTable result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    expect(screen.getByText("Only in v2.0.0")).toBeInTheDocument();
    expect(screen.getByText("new-side commit")).toBeInTheDocument();
    expect(screen.getByText("Only in v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("old-side commit")).toBeInTheDocument();
  });

  it("hides the base section when direction is new-only", () => {
    render(<CompareTable result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="new-only" />);
    expect(screen.getByText("new-side commit")).toBeInTheDocument();
    expect(screen.queryByText("Only in v1.0.0")).not.toBeInTheDocument();
    expect(screen.queryByText("old-side commit")).not.toBeInTheDocument();
  });

  it("shows a no-unique-commits message for an empty side", () => {
    const oneSided = { ...result, onlyInBase: [] };
    render(<CompareTable result={oneSided as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    expect(screen.getByText("No unique commits")).toBeInTheDocument();
  });
});
