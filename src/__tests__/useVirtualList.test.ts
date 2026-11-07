import { describe, it, expect } from "vitest";
import { computeWindow } from "../hooks/useVirtualList";

const base = { itemHeight: 24, overscan: 2, fallbackCount: 10 };

describe("computeWindow", () => {
  it("falls back to the first rows when there is no layout", () => {
    expect(computeWindow({ ...base, count: 1000, scrollTop: 0, viewportHeight: 0 })).toEqual({
      start: 0,
      end: 10,
      padTop: 0,
      padBottom: 990 * 24,
    });
  });

  it("renders everything when the list is shorter than the fallback", () => {
    const w = computeWindow({ ...base, count: 3, scrollTop: 0, viewportHeight: 0 });
    expect([w.start, w.end, w.padBottom]).toEqual([0, 3, 0]);
  });

  it("windows around the scroll position with overscan", () => {
    const w = computeWindow({ ...base, count: 1000, scrollTop: 2400, viewportHeight: 240 });
    expect(w.start).toBe(98); // row 100 - overscan
    expect(w.end).toBe(112); // row 110 + overscan
    expect(w.padTop).toBe(98 * 24);
    expect(w.padBottom).toBe((1000 - 112) * 24);
  });

  it("clamps at the end of the list", () => {
    const w = computeWindow({ ...base, count: 50, scrollTop: 50 * 24, viewportHeight: 240 });
    expect(w.end).toBe(50);
    expect(w.padBottom).toBe(0);
    expect(w.start).toBeLessThanOrEqual(w.end);
  });
});
