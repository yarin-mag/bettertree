import { describe, it, expect } from "vitest";
import {
  DEFAULT_REPO_SETTINGS,
  compileTicketPattern,
  ticketPatternError,
  linkingConfigured,
} from "../lib/repoSettings";

describe("repoSettings helpers", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_REPO_SETTINGS).toEqual({
      ticketPattern: "CEM-\\d+",
      jiraBaseUrl: "https://cemento.atlassian.net/browse/",
      worktreeDir: "",
      releaseTagPattern: "",
    });
  });

  it("compiles a pattern into a whole-word global regex", () => {
    const re = compileTicketPattern("CEM-\\d+")!;
    expect("fix CEM-12 and CEM-34".match(re)).toEqual(["CEM-12", "CEM-34"]);
    expect("XCEM-12".match(re)).toBeNull();
  });

  it("returns null for an empty or invalid pattern", () => {
    expect(compileTicketPattern("")).toBeNull();
    expect(compileTicketPattern("   ")).toBeNull();
    expect(compileTicketPattern("CEM-(")).toBeNull();
  });

  it("reports a readable error only for an invalid pattern", () => {
    expect(ticketPatternError("CEM-\\d+")).toBeNull();
    expect(ticketPatternError("")).toBeNull();
    expect(ticketPatternError("CEM-(")).toMatch(/./);
  });

  it("linking needs both a valid pattern and a URL", () => {
    expect(linkingConfigured(DEFAULT_REPO_SETTINGS)).toBe(true);
    expect(linkingConfigured({ ...DEFAULT_REPO_SETTINGS, jiraBaseUrl: "" })).toBe(false);
    expect(linkingConfigured({ ...DEFAULT_REPO_SETTINGS, ticketPattern: "" })).toBe(false);
    expect(linkingConfigured({ ...DEFAULT_REPO_SETTINGS, ticketPattern: "CEM-(" })).toBe(false);
  });

  it("treats a pattern that can match empty text as invalid", () => {
    for (const p of ["CEM-\\d+|", "\\d*", "(CEM-\\d+)?"]) {
      expect(ticketPatternError(p)).toMatch(/empty/i);
      expect(compileTicketPattern(p)).toBeNull();
    }
  });
});
