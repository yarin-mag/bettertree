import { describe, it, expect } from "vitest";
import { laneColor } from "../lib/laneColor";

describe("laneColor", () => {
  it("lane 0 is always the accent color", () => {
    expect(laneColor(0)).toBe("var(--accent)");
  });

  it("cycles through the palette for lanes 1+", () => {
    expect(laneColor(1)).toBe("#4ea1f0");
    expect(laneColor(2)).toBe("#c785f0");
    expect(laneColor(6)).toBe(laneColor(1)); // wraps around after 5 palette colors
  });
});
