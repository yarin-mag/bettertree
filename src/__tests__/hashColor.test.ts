import { describe, it, expect } from "vitest";
import { hashHue } from "../lib/hashColor";

describe("hashHue", () => {
  it("returns a value in [0, 360)", () => {
    expect(hashHue("avery")).toBeGreaterThanOrEqual(0);
    expect(hashHue("avery")).toBeLessThan(360);
  });

  it("is deterministic for the same input", () => {
    expect(hashHue("priya")).toBe(hashHue("priya"));
  });

  it("differs for different inputs", () => {
    expect(hashHue("avery")).not.toBe(hashHue("priya"));
  });
});
