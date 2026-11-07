import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/tauri", () => ({ invokeSearchCommits: vi.fn() }));

import { useSavedSearchStore, EMPTY_FILTERS } from "../store/savedSearchStore";
import { useSearchStore } from "../store/searchStore";
import * as tauriLib from "../lib/tauri";

const f = (q: string) => ({ ...EMPTY_FILTERS, historyQuery: q });

describe("savedSearchStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSavedSearchStore.setState({ recent: [], saved: [] });
  });

  it("records recent searches newest first, deduped and capped", () => {
    const s = useSavedSearchStore.getState();
    for (let i = 0; i < 12; i++) s.addRecent(f("q" + i));
    s.addRecent(f("q5"));
    const recent = useSavedSearchStore.getState().recent;
    expect(recent).toHaveLength(10);
    expect(recent[0].filters.historyQuery).toBe("q5");
    expect(recent.filter((r) => r.filters.historyQuery === "q5")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("search.recent")!)).toHaveLength(10);
  });

  it("ignores fully empty searches", () => {
    useSavedSearchStore.getState().addRecent(EMPTY_FILTERS);
    expect(useSavedSearchStore.getState().recent).toHaveLength(0);
  });

  it("removes and clears recents", () => {
    const s = useSavedSearchStore.getState();
    s.addRecent(f("a"));
    s.addRecent(f("b"));
    useSavedSearchStore.getState().removeRecent(0);
    expect(useSavedSearchStore.getState().recent.map((r) => r.filters.historyQuery)).toEqual(["a"]);
    useSavedSearchStore.getState().clearRecent();
    expect(useSavedSearchStore.getState().recent).toEqual([]);
  });

  it("saves, replaces by name and deletes named searches", () => {
    const s = useSavedSearchStore.getState();
    s.saveSearch("  mine ", f("a"));
    s.saveSearch("", f("x"));
    useSavedSearchStore.getState().saveSearch("mine", f("b"));
    const saved = useSavedSearchStore.getState().saved;
    expect(saved).toHaveLength(1);
    expect(saved[0].filters.historyQuery).toBe("b");
    useSavedSearchStore.getState().removeSaved(saved[0].id);
    expect(useSavedSearchStore.getState().saved).toEqual([]);
  });
});

describe("searchStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useSavedSearchStore.setState({ recent: [], saved: [] });
    useSearchStore.getState().clearFilters();
  });

  it("persists filter edits and clears them", () => {
    useSearchStore.getState().setAuthorFilter("bob");
    expect(JSON.parse(localStorage.getItem("search.filters")!).authorFilter).toBe("bob");
    useSearchStore.getState().clearFilters();
    expect(useSearchStore.getState().authorFilter).toBe("");
    expect(JSON.parse(localStorage.getItem("search.filters")!).authorFilter).toBe("");
  });

  it("applyFilters restores all fields", () => {
    useSearchStore.getState().applyFilters({ ...EMPTY_FILTERS, historyQuery: "x", filePathFilter: "a.ts" });
    expect(useSearchStore.getState().historyQuery).toBe("x");
    expect(useSearchStore.getState().filePathFilter).toBe("a.ts");
  });

  it("records a recent search after a successful run", async () => {
    (tauriLib.invokeSearchCommits as any).mockResolvedValue([]);
    useSearchStore.getState().setHistoryQuery("needle");
    await useSearchStore.getState().runAdvancedSearch("/tmp/a");
    expect(useSavedSearchStore.getState().recent[0].filters.historyQuery).toBe("needle");
  });
});
