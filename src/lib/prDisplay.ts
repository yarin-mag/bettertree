export function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export interface Badge {
  label: string;
  className: string;
}

/** Maps a PR's overall CI rollup to a small badge, or null if it has no checks. */
export function checkStatusBadge(rollup: "success" | "pending" | "failure" | null): Badge | null {
  switch (rollup) {
    case "success":
      return { label: "Checks passing", className: "bg-success-soft text-success" };
    case "pending":
      return { label: "Checks running", className: "bg-elevated border border-border-subtle text-text-muted" };
    case "failure":
      return { label: "Checks failing", className: "bg-danger-soft text-danger" };
    default:
      return null;
  }
}

/** Maps GitHub's reviewDecision string to a small badge, or null if unreviewed. */
export function reviewDecisionBadge(decision: string | null): Badge | null {
  switch (decision) {
    case "APPROVED":
      return { label: "Approved", className: "bg-success-soft text-success" };
    case "CHANGES_REQUESTED":
      return { label: "Changes requested", className: "bg-danger-soft text-danger" };
    case "REVIEW_REQUIRED":
      return { label: "Review required", className: "bg-elevated border border-border-subtle text-text-muted" };
    default:
      return null;
  }
}

export function statusLabel(pr: { state: string; isDraft: boolean }): { label: string; className: string } {
  if (pr.isDraft) return { label: "Draft", className: "bg-elevated border border-border-subtle text-text-muted" };
  switch (pr.state.toUpperCase()) {
    case "MERGED":
      return { label: "Merged", className: "bg-merged-soft text-merged" };
    case "CLOSED":
      return { label: "Closed", className: "bg-danger-soft text-danger" };
    default:
      return { label: "Open", className: "bg-success-soft text-success" };
  }
}
