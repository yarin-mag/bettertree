import { describe, it, expect } from "vitest";
import { initials, statusLabel, checkStatusBadge, reviewDecisionBadge } from "../lib/prDisplay";

describe("initials", () => {
  it("returns the first two characters, uppercased", () => {
    expect(initials("yarinmag")).toBe("YA");
  });
});

describe("statusLabel", () => {
  it("returns Draft for a draft PR regardless of state", () => {
    expect(statusLabel({ state: "OPEN", isDraft: true })).toEqual({
      label: "Draft",
      className: "bg-elevated border border-border-subtle text-text-muted",
    });
  });

  it("returns Merged for a merged, non-draft PR", () => {
    expect(statusLabel({ state: "MERGED", isDraft: false })).toEqual({
      label: "Merged",
      className: "bg-merged-soft text-merged",
    });
  });

  it("returns Closed for a closed, non-draft PR", () => {
    expect(statusLabel({ state: "CLOSED", isDraft: false })).toEqual({
      label: "Closed",
      className: "bg-danger-soft text-danger",
    });
  });

  it("returns Open for an open, non-draft PR", () => {
    expect(statusLabel({ state: "OPEN", isDraft: false })).toEqual({
      label: "Open",
      className: "bg-success-soft text-success",
    });
  });
});

describe("checkStatusBadge", () => {
  it("returns null when there are no checks", () => {
    expect(checkStatusBadge(null)).toBeNull();
  });

  it("returns a passing badge for success", () => {
    expect(checkStatusBadge("success")).toEqual({ label: "Checks passing", className: "bg-success-soft text-success" });
  });

  it("returns a running badge for pending", () => {
    expect(checkStatusBadge("pending")?.label).toBe("Checks running");
  });

  it("returns a failing badge for failure", () => {
    expect(checkStatusBadge("failure")).toEqual({ label: "Checks failing", className: "bg-danger-soft text-danger" });
  });
});

describe("reviewDecisionBadge", () => {
  it("returns null when unreviewed", () => {
    expect(reviewDecisionBadge(null)).toBeNull();
  });

  it("returns an approved badge", () => {
    expect(reviewDecisionBadge("APPROVED")).toEqual({ label: "Approved", className: "bg-success-soft text-success" });
  });

  it("returns a changes-requested badge", () => {
    expect(reviewDecisionBadge("CHANGES_REQUESTED")).toEqual({
      label: "Changes requested",
      className: "bg-danger-soft text-danger",
    });
  });

  it("returns null for an unrecognized decision string", () => {
    expect(reviewDecisionBadge("SOMETHING_NEW")).toBeNull();
  });
});
