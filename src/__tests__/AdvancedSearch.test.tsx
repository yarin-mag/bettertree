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
      advancedResults: [],
    });
  });

  it("runs a search against the active repo and renders results", async () => {
    (tauriLib.invokeSearchCommits as any).mockResolvedValue([
      { oid: "c2", summary: "second commit", author: "Test User", timestamp: 200, snippet: "...two..." },
    ]);

    render(<AdvancedSearch />);
    fireEvent.change(screen.getByPlaceholderText("Message or code..."), { target: { value: "two" } });
    fireEvent.click(screen.getByRole("button", { name: "Search history" }));

    await waitFor(() => {
      expect(screen.getByTestId("search-hit")).toBeInTheDocument();
    });
    expect(tauriLib.invokeSearchCommits).toHaveBeenCalledWith("/tmp/a", "two", undefined, undefined, undefined);
  });

  it("does nothing when no repo is active", () => {
    useWorkspaceStore.setState({ repos: [], activeRepoId: null });
    render(<AdvancedSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Search history" }));
    expect(tauriLib.invokeSearchCommits).not.toHaveBeenCalled();
  });
});
