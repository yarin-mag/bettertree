import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeSearchCommits: vi.fn(),
}));

import { useSearchStore } from "../store/searchStore";
import * as tauriLib from "../lib/tauri";

describe("searchStore isSearchActive", () => {
  beforeEach(() => {
    useSearchStore.setState({ isSearchActive: false });
  });

  it("defaults to inactive", () => {
    expect(useSearchStore.getState().isSearchActive).toBe(false);
  });

  it("activateSearch sets isSearchActive to true", () => {
    useSearchStore.getState().activateSearch();
    expect(useSearchStore.getState().isSearchActive).toBe(true);
  });

  it("deactivateSearch sets isSearchActive to false", () => {
    useSearchStore.setState({ isSearchActive: true });
    useSearchStore.getState().deactivateSearch();
    expect(useSearchStore.getState().isSearchActive).toBe(false);
  });
});

describe("searchStore commitId/filePath filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchStore.setState({
      historyQuery: "",
      authorFilter: "",
      sinceFilter: "",
      untilFilter: "",
      commitIdFilter: "",
      filePathFilter: "",
      advancedResults: [],
    });
  });

  it("default to empty", () => {
    expect(useSearchStore.getState().commitIdFilter).toBe("");
    expect(useSearchStore.getState().filePathFilter).toBe("");
  });

  it("runAdvancedSearch passes commitId and filePath filters to the backend", async () => {
    (tauriLib.invokeSearchCommits as any).mockResolvedValue([]);
    useSearchStore.setState({ commitIdFilter: "abc123", filePathFilter: "src/foo.ts" });

    await useSearchStore.getState().runAdvancedSearch("/tmp/a");

    expect(tauriLib.invokeSearchCommits).toHaveBeenCalledWith(
      "/tmp/a",
      "",
      undefined,
      undefined,
      undefined,
      "abc123",
      "src/foo.ts"
    );
  });
});
