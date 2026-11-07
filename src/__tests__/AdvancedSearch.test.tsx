import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import AdvancedSearch from "../components/AdvancedSearch";

vi.mock("../lib/tauri", () => ({
  invokeSearchCommits: vi.fn(),
}));

import * as tauriLib from "../lib/tauri";

describe("AdvancedSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
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

  it("runs a search against the active repo", async () => {
    (tauriLib.invokeSearchCommits as any).mockResolvedValue([
      { oid: "c2", summary: "second commit", author: "Test User", timestamp: 200, snippet: "...two..." },
    ]);

    render(<AdvancedSearch />);
    fireEvent.change(screen.getByPlaceholderText("Message or code..."), { target: { value: "two" } });
    fireEvent.click(screen.getByRole("button", { name: "Search history" }));

    await waitFor(() => {
      expect(tauriLib.invokeSearchCommits).toHaveBeenCalled();
    });
    expect(tauriLib.invokeSearchCommits).toHaveBeenCalledWith(
      "/tmp/a",
      "two",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  it("does nothing when no repo is active", () => {
    useWorkspaceStore.setState({ repos: [], activeRepoId: null });
    render(<AdvancedSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Search history" }));
    expect(tauriLib.invokeSearchCommits).not.toHaveBeenCalled();
  });

  it("passes commit id and file path filters entered by the user", async () => {
    (tauriLib.invokeSearchCommits as any).mockResolvedValue([]);

    render(<AdvancedSearch />);
    fireEvent.change(screen.getByPlaceholderText("Commit SHA..."), { target: { value: "abc123" } });
    fireEvent.change(screen.getByPlaceholderText("File path..."), { target: { value: "src/foo.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Search history" }));

    await waitFor(() => {
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
});

import { useSavedSearchStore } from "../store/savedSearchStore";

describe("AdvancedSearch saved/recent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useSearchStore.getState().clearFilters();
    useSavedSearchStore.setState({ recent: [], saved: [] });
    (tauriLib.invokeSearchCommits as any).mockResolvedValue([]);
  });

  it("clicking a recent search restores filters and re-runs", async () => {
    useSavedSearchStore.getState().addRecent({
      historyQuery: "old", authorFilter: "bob", sinceFilter: "", untilFilter: "", commitIdFilter: "", filePathFilter: "",
    });
    render(<AdvancedSearch />);
    fireEvent.click(screen.getByTestId("recent-search"));
    await waitFor(() => expect(tauriLib.invokeSearchCommits).toHaveBeenCalled());
    expect(useSearchStore.getState().authorFilter).toBe("bob");
    expect(tauriLib.invokeSearchCommits).toHaveBeenCalledWith("/tmp/a", "old", "bob", undefined, undefined, undefined, undefined);
  });

  it("saves a named search and applies it", async () => {
    render(<AdvancedSearch />);
    fireEvent.change(screen.getByPlaceholderText("Message or code..."), { target: { value: "fix" } });
    fireEvent.click(screen.getByRole("button", { name: "Save search" }));
    const input = screen.getByPlaceholderText(/Name this search/);
    fireEvent.change(input, { target: { value: "Fixes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useSavedSearchStore.getState().saved[0].name).toBe("Fixes");
    useSearchStore.getState().clearFilters();
    fireEvent.click(screen.getByText("Fixes"));
    await waitFor(() => expect(tauriLib.invokeSearchCommits).toHaveBeenCalled());
    expect(useSearchStore.getState().historyQuery).toBe("fix");
  });

  it("Clear filters empties the form", () => {
    useSearchStore.getState().setHistoryQuery("zzz");
    render(<AdvancedSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(useSearchStore.getState().historyQuery).toBe("");
  });
});
