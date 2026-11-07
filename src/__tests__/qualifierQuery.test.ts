import { describe, it, expect } from "vitest";
import { getQualifier, setQualifier } from "../lib/qualifierQuery";

describe("qualifierQuery", () => {
  describe("setQualifier", () => {
    it("appends a new qualifier to an empty query", () => {
      expect(setQualifier("", "author", "yarinmag")).toBe("author:yarinmag");
    });

    it("appends a new qualifier to an existing query", () => {
      expect(setQualifier("is:open", "author", "yarinmag")).toBe("is:open author:yarinmag");
    });

    it("replaces an existing qualifier's value rather than duplicating it", () => {
      expect(setQualifier("author:someone is:open", "author", "yarinmag")).toBe(
        "author:yarinmag is:open"
      );
    });

    it("removes the qualifier when value is null", () => {
      expect(setQualifier("author:yarinmag is:open", "author", null)).toBe("is:open");
    });

    it("is a no-op removing a qualifier that isn't present", () => {
      expect(setQualifier("is:open", "author", null)).toBe("is:open");
    });

    it("quotes values containing spaces", () => {
      expect(setQualifier("", "base", "release branch")).toBe('base:"release branch"');
    });
  });

  describe("getQualifier", () => {
    it("returns the value for a present qualifier", () => {
      expect(getQualifier("author:yarinmag is:open", "author")).toBe("yarinmag");
    });

    it("returns undefined for an absent qualifier", () => {
      expect(getQualifier("is:open", "author")).toBeUndefined();
    });

    it("unquotes a quoted value", () => {
      expect(getQualifier('base:"release branch" is:open', "base")).toBe("release branch");
    });
  });
});
