import { describe, it, expect } from "vitest";
import { TABS_COMPACT_BELOW, isCompactTabs } from "../lib/sidebarTabs";

describe("isCompactTabs", () => {
  it("uses 330 as the threshold", () => {
    expect(TABS_COMPACT_BELOW).toBe(330);
  });
  it("is compact strictly below the threshold", () => {
    expect(isCompactTabs(200)).toBe(true);
    expect(isCompactTabs(329)).toBe(true);
    expect(isCompactTabs(330)).toBe(false);
    expect(isCompactTabs(340)).toBe(false);
    expect(isCompactTabs(520)).toBe(false);
  });
});
