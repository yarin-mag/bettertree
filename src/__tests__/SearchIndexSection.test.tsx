import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeListSearchIndexUsage: vi.fn(),
  invokeClearSearchIndex: vi.fn(),
}));

import * as tauri from "../lib/tauri";
import { formatBytes } from "../lib/formatBytes";
import SearchIndexSection from "../components/SearchIndexSection";

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(13 * 1024 ** 3)).toBe("13.0 GB");
  });
});

describe("SearchIndexSection", () => {
  const usage = [
    { key: "a".repeat(16), repoPath: "/work/client/staging-web", sizeBytes: 3 * 1024 * 1024, lastUsed: 1 },
    { key: "b".repeat(16), repoPath: null, sizeBytes: 1024, lastUsed: 0 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauri.invokeListSearchIndexUsage).mockResolvedValue(usage);
    vi.mocked(tauri.invokeClearSearchIndex).mockResolvedValue(undefined);
  });

  it("lists each index with its size and the total", async () => {
    render(<SearchIndexSection />);
    expect(await screen.findByText("staging-web")).toBeTruthy();
    expect(screen.getByText("3.0 MB")).toBeTruthy();
    expect(screen.getByText("Unknown repository")).toBeTruthy();
    expect(screen.getByText(/Total 3\.0 MB/)).toBeTruthy();
  });

  it("clears one index and refreshes the list", async () => {
    render(<SearchIndexSection />);
    await screen.findByText("staging-web");
    vi.mocked(tauri.invokeListSearchIndexUsage).mockResolvedValue([usage[1]]);
    fireEvent.click(screen.getByRole("button", { name: "Clear index for staging-web" }));
    await waitFor(() => expect(tauri.invokeClearSearchIndex).toHaveBeenCalledWith(usage[0].key));
    await waitFor(() => expect(screen.queryByText("staging-web")).toBeNull());
  });

  it("clears everything", async () => {
    render(<SearchIndexSection />);
    await screen.findByText("staging-web");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(tauri.invokeClearSearchIndex).toHaveBeenCalledWith(undefined));
  });

  it("shows an empty state", async () => {
    vi.mocked(tauri.invokeListSearchIndexUsage).mockResolvedValue([]);
    render(<SearchIndexSection />);
    expect(await screen.findByText(/No search index yet/)).toBeTruthy();
  });

  it("survives a failing usage call", async () => {
    vi.mocked(tauri.invokeListSearchIndexUsage).mockRejectedValue(new Error("boom"));
    render(<SearchIndexSection />);
    expect(await screen.findByText(/No search index yet/)).toBeTruthy();
  });
});
