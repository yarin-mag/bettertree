import { describe, it, expect } from "vitest";
import { classifyCiError, shortCiError } from "../lib/ciErrors";
import { workflowTitle, sortRuns, badgeState, badgeTitle, formatDuration, firstFailedStep, parseLogSteps } from "../lib/ci";
import type { CiWorkflowRun, CommitCi, CiJob } from "../lib/tauri";

const run = (name: string, status: string, conclusion: string | null): CiWorkflowRun => ({
  runId: 1, workflowId: 1, workflowName: name, status, conclusion, url: "", startedAt: null, updatedAt: null, jobs: [],
});

describe("classifyCiError", () => {
  it("recognizes the common gh failures", () => {
    expect(classifyCiError("failed to run gh: No such file").kind).toBe("no-gh");
    expect(classifyCiError("gh: To get started with GitHub CLI, please run: gh auth login").kind).toBe("unauthenticated");
    expect(classifyCiError("HTTP 403: API rate limit exceeded").kind).toBe("rate-limited");
    expect(classifyCiError("HTTP 403: Resource not accessible by integration").kind).toBe("forbidden");
    expect(classifyCiError("boom").kind).toBe("other");
  });
  it("does not treat a 403 inside a hex oid as forbidden", () => {
    expect(classifyCiError("head_sha=ab403cd0123 failed: connection reset").kind).toBe("other");
  });
  it("treats HTTP 401 / bad credentials as unauthenticated", () => {
    expect(classifyCiError("HTTP 401: Bad credentials").kind).toBe("unauthenticated");
    expect(classifyCiError("bad credentials").kind).toBe("unauthenticated");
  });
  it("shortCiError caps the text", () => {
    expect(shortCiError("short")).toBe("short");
    const out = shortCiError("x".repeat(500));
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith("…")).toBe(true);
    expect(shortCiError("y".repeat(50), 10)).toBe("y".repeat(10) + "…");
  });
});

describe("workflowTitle", () => {
  it("shows custom name with original muted, and ignores blank custom names", () => {
    expect(workflowTitle("CI", "My CI")).toEqual({ title: "My CI", original: "CI" });
    expect(workflowTitle("CI", "   ")).toEqual({ title: "CI", original: null });
    expect(workflowTitle("CI", undefined)).toEqual({ title: "CI", original: null });
    expect(workflowTitle("", undefined).title).toBe("Workflow");
  });
});

describe("sortRuns", () => {
  it("orders failures, then running, then success", () => {
    const sorted = sortRuns([run("b", "completed", "success"), run("a", "in_progress", null), run("c", "completed", "failure")]);
    expect(sorted.map((r) => r.workflowName)).toEqual(["c", "a", "b"]);
  });
});

describe("badgeState", () => {
  const ci: CommitCi = {
    oid: "x", state: "failure", total: 3, failed: 1, pending: 0,
    byWorkflow: [
      { workflowId: 1, workflowName: "CI", state: "success" },
      { workflowId: 2, workflowName: "Lint", state: "failure" },
    ],
  };
  it("follows favorites when enabled and some favorite is present on the commit", () => {
    expect(badgeState(ci, { favorites: [1], followFavorites: true })).toBe("success");
    expect(badgeState(ci, { favorites: [2], followFavorites: true })).toBe("failure");
  });
  it("falls back to whole commit when no favorites, none present, or following is off", () => {
    expect(badgeState(ci, { favorites: [], followFavorites: true })).toBe("failure");
    expect(badgeState(ci, { favorites: [99], followFavorites: true })).toBe("failure");
    expect(badgeState(ci, { favorites: [1], followFavorites: false })).toBe("failure");
  });
});

describe("badgeState with none-state favorites", () => {
  const mk = (states: ("success" | "failure" | "pending" | "none")[]): CommitCi => ({
    oid: "x", state: "failure", total: 3, failed: 1, pending: 0,
    byWorkflow: states.map((state, i) => ({ workflowId: i + 1, workflowName: `w${i + 1}`, state })),
  });
  it("falls back to ci.state when present favorites are all none", () => {
    expect(badgeState(mk(["none", "success"]), { favorites: [1], followFavorites: true })).toBe("failure");
  });
  it("ignores none favorites when mixed with success or failure", () => {
    expect(badgeState(mk(["none", "success"]), { favorites: [1, 2], followFavorites: true })).toBe("success");
    expect(badgeState(mk(["none", "failure"]), { favorites: [1, 2], followFavorites: true })).toBe("failure");
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and handles missing times", () => {
    expect(formatDuration("2026-09-30T10:00:00Z", "2026-09-30T10:00:42Z")).toBe("42s");
    expect(formatDuration("2026-09-30T10:00:00Z", "2026-09-30T10:04:05Z")).toBe("4m 5s");
    expect(formatDuration(null, null)).toBe("");
  });
});

describe("firstFailedStep", () => {
  const job = (steps: { number: number; conclusion: string | null }[]): CiJob => ({
    jobId: 1, name: "j", status: "completed", conclusion: "failure", startedAt: null, completedAt: null, url: "",
    steps: steps.map((s) => ({ ...s, name: `s${s.number}`, status: "completed" })),
  });
  it("returns the first failed step or null when none recorded", () => {
    expect(firstFailedStep(job([{ number: 1, conclusion: "success" }, { number: 2, conclusion: "failure" }]))).toBe(2);
    expect(firstFailedStep(job([{ number: 1, conclusion: "cancelled" }]))).toBeNull();
    expect(firstFailedStep(job([]))).toBeNull();
  });
});

describe("parseLogSteps", () => {
  it("groups gh log lines (job\\tstep\\ttime content) by step, keeping order", () => {
    const text = "test\tSet up job\t2026-09-30T10:00:00.0Z hello\ntest\tRun tests\t2026-09-30T10:00:01.0Z boom\ntest\tRun tests\t2026-09-30T10:00:02.0Z bang\n";
    const steps = parseLogSteps(text);
    expect(steps.map((s) => s.stepName)).toEqual(["Set up job", "Run tests"]);
    expect(steps[1].lines).toEqual(["boom", "bang"]);
  });
  it("keeps unparseable lines under an 'Output' step instead of dropping them", () => {
    expect(parseLogSteps("just text\n")).toEqual([{ stepName: "Output", lines: ["just text"] }]);
  });
});

describe("badgeTitle", () => {
  const base: CommitCi = { oid: "a", state: "failure", total: 2, failed: 1, pending: 0, byWorkflow: [{ workflowId: 7, workflowName: "CI", state: "success" }] };
  it("omits '(favorites only)' when favorites did not apply", () => {
    expect(badgeTitle(base, { favorites: [99], followFavorites: true })).toBe("1 of 2 failed");
    expect(badgeTitle(base, { favorites: [], followFavorites: true })).toBe("1 of 2 failed");
    expect(badgeTitle(base, { favorites: [7], followFavorites: false })).toBe("1 of 2 failed");
  });
  it("appends '(favorites only)' when a favorite is present", () => {
    expect(badgeTitle(base, { favorites: [7], followFavorites: true })).toBe("1 of 2 failed (favorites only)");
  });
});
