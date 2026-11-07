import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CompareTimeline from "../components/CompareTimeline";

const result = {
  baseOid: "b",
  compareOid: "c",
  mergeBaseOid: "m",
  onlyInBase: [{ oid: "b1", summary: "old-side commit", author: "avery", timestamp: 100 }],
  onlyInCompare: [
    { oid: "c1", summary: "newer commit", author: "yarinmag", timestamp: 300 },
    { oid: "c2", summary: "older new-side commit", author: "yarinmag", timestamp: 200 },
  ],
  graph: [],
};

describe("CompareTimeline", () => {
  it("shows both columns with their titles and commits when direction is both", () => {
    render(<CompareTimeline result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    expect(screen.getByText("Only in v2.0.0")).toBeInTheDocument();
    expect(screen.getByText("newer commit")).toBeInTheDocument();
    expect(screen.getByText("older new-side commit")).toBeInTheDocument();
    expect(screen.getByText("Only in v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("old-side commit")).toBeInTheDocument();
  });

  it("hides the base column when direction is new-only", () => {
    render(<CompareTimeline result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="new-only" />);
    expect(screen.queryByText("Only in v1.0.0")).not.toBeInTheDocument();
    expect(screen.queryByText("old-side commit")).not.toBeInTheDocument();
  });

  it("sorts each column by timestamp, newest first", () => {
    render(<CompareTimeline result={result as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    const summaries = screen.getAllByText(/commit$/).map((el) => el.textContent);
    const newerIdx = summaries.indexOf("newer commit");
    const olderIdx = summaries.indexOf("older new-side commit");
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("shows a no-unique-commits message for an empty column", () => {
    const oneSided = { ...result, onlyInBase: [] };
    render(<CompareTimeline result={oneSided as any} baseRef="v1.0.0" compareRef="v2.0.0" direction="both" />);
    expect(screen.getByText("No unique commits")).toBeInTheDocument();
  });
});
