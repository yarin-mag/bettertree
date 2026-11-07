import { describe, it, expect } from "vitest";
import { timeAgo } from "../lib/timeAgo";

describe("timeAgo", () => {
  const now = 10_000_000;
  it("formats recent, seconds, minutes, hours and days", () => {
    expect(timeAgo(now - 3_000, now)).toBe("just now");
    expect(timeAgo(now - 30_000, now)).toBe("30s ago");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe("3d ago");
  });
});

import { nextFetchDelay, AUTO_FETCH_INTERVAL_MS, AUTO_FETCH_MAX_BACKOFF_MS } from "../hooks/useAutoFetch";

describe("nextFetchDelay", () => {
  it("backs off exponentially and caps", () => {
    expect(nextFetchDelay(0)).toBe(AUTO_FETCH_INTERVAL_MS);
    expect(nextFetchDelay(1)).toBe(AUTO_FETCH_INTERVAL_MS * 2);
    expect(nextFetchDelay(10)).toBe(AUTO_FETCH_MAX_BACKOFF_MS);
  });
});
