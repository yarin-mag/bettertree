import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeCiStatusForCommits: vi.fn(),
  invokeCiCommitChecks: vi.fn(),
  invokeCiRerun: vi.fn(),
  invokeCiCancel: vi.fn(),
}));
import * as tauri from "../lib/tauri";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { useCiStatusStore, resetCiStatus, CI_POLL_MS, NONE_RECHECK_MS } from "../store/ciStatusStore";
import { useCiChecksStore } from "../store/ciChecksStore";
import { useToastStore } from "../store/toastStore";
import { render, act } from "@testing-library/react";
import React from "react";

const ci = (oid: string, state: any = "success") => ({ oid, state, total: 1, failed: 0, pending: state === "pending" ? 1 : 0, byWorkflow: [] });

describe("ciPrefsStore", () => {
  beforeEach(() => { localStorage.clear(); useCiPrefsStore.setState({ prefs: {} } as any); });
  it("keeps names and favorites per repo and persists them", () => {
    const s = useCiPrefsStore.getState();
    s.setName("/a", 1, "My CI");
    s.toggleFavorite("/a", 1);
    expect(useCiPrefsStore.getState().getPrefs("/a")).toMatchObject({ names: { 1: "My CI" }, favorites: [1] });
    expect(useCiPrefsStore.getState().getPrefs("/b").favorites).toEqual([]);
    expect(JSON.parse(localStorage.getItem("ciPrefs")!)["/a"].favorites).toEqual([1]);
    s.toggleFavorite("/a", 1);
    expect(useCiPrefsStore.getState().getPrefs("/a").favorites).toEqual([]);
  });
  it("an empty name removes the custom name", () => {
    const s = useCiPrefsStore.getState();
    s.setName("/a", 1, "X");
    s.setName("/a", 1, "  ");
    expect(useCiPrefsStore.getState().getPrefs("/a").names[1]).toBeUndefined();
  });
  it("getPrefs returns referentially stable objects until that repo changes", () => {
    const s = useCiPrefsStore.getState();
    expect(s.getPrefs("/none")).toBe(s.getPrefs("/none"));
    s.toggleFavorite("/a", 0);
    s.setName("/b", 2, "B");
    const a1 = useCiPrefsStore.getState().getPrefs("/a");
    const b1 = useCiPrefsStore.getState().getPrefs("/b");
    expect(useCiPrefsStore.getState().getPrefs("/a")).toBe(a1);
    useCiPrefsStore.getState().toggleFavorite("/a", 1);
    const a2 = useCiPrefsStore.getState().getPrefs("/a");
    expect(a2).not.toBe(a1);
    expect(a2.favorites).toEqual([0, 1]);
    expect(useCiPrefsStore.getState().getPrefs("/b")).toBe(b1);
    useCiPrefsStore.setState({ prefs: {} } as any);
    expect(useCiPrefsStore.getState().getPrefs("/a").favorites).toEqual([]);
  });
  it("a selector on getPrefs does not re-render for unrelated repo changes", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    let renders = 0;
    const C = () => {
      const p = useCiPrefsStore((st) => st.getPrefs("/a"));
      renders += 1;
      return React.createElement("div", null, String(p.favorites.length));
    };
    const { container } = render(React.createElement(C));
    const before = renders;
    act(() => useCiPrefsStore.getState().toggleFavorite("/other", 1));
    expect(renders).toBe(before);
    act(() => useCiPrefsStore.getState().toggleFavorite("/a", 1));
    expect(container.textContent).toBe("1");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("ciPrefsStore load sanitizing", () => {
  it("survives valid JSON of the wrong shape", async () => {
    vi.resetModules();
    for (const raw of ['null', '[1]', '"x"', '{"/a":{"names":null,"favorites":"x","favoritesOnly":"y","badgeFollowsFavorites":0}}', '{"/b":null}']) {
      localStorage.setItem("ciPrefs", raw);
      vi.resetModules();
      const { useCiPrefsStore: store } = await import("../store/ciPrefsStore");
      const p = store.getState().getPrefs("/a");
      expect(p.names).toEqual({});
      expect(p.favorites).toEqual([]);
      expect(p.favoritesOnly).toBe(false);
      expect(p.badgeFollowsFavorites).toBe(true);
    }
    localStorage.clear();
  });
  it("keeps valid entries", async () => {
    localStorage.setItem("ciPrefs", JSON.stringify({ "/a": { names: { 1: "X" }, favorites: [1, "z", 2], favoritesOnly: true, badgeFollowsFavorites: false } }));
    vi.resetModules();
    const { useCiPrefsStore: store } = await import("../store/ciPrefsStore");
    expect(store.getState().getPrefs("/a")).toEqual({ names: { 1: "X" }, favorites: [1, 2], favoritesOnly: true, badgeFollowsFavorites: false });
    localStorage.clear();
  });
});

describe("ciStatusStore", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); resetCiStatus(); useToastStore.setState({ toasts: [] } as any); });
  afterEach(() => { resetCiStatus(); vi.useRealTimers(); });

  it("debounces and batches requested oids into one call, skipping settled ones", async () => {
    (tauri.invokeCiStatusForCommits as any).mockResolvedValue([ci("a"), ci("b")]);
    const s = useCiStatusStore.getState();
    s.request("/r", ["a"]); s.request("/r", ["b", "a"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(1);
    expect((tauri.invokeCiStatusForCommits as any).mock.calls[0][1].sort()).toEqual(["a", "b"]);
    s.request("/r", ["a", "b"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(1);
  });

  it("re-requests a 'none' oid only after NONE_RECHECK_MS; success is never re-requested", async () => {
    (tauri.invokeCiStatusForCommits as any).mockResolvedValue([ci("n", "none"), ci("s", "success")]);
    const s = useCiStatusStore.getState();
    s.request("/r", ["n", "s"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(NONE_RECHECK_MS - 5000);
    s.request("/r", ["n", "s"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    (tauri.invokeCiStatusForCommits as any).mockResolvedValue([ci("n", "success")]);
    s.request("/r", ["n", "s"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(2);
    expect((tauri.invokeCiStatusForCommits as any).mock.calls[1][1]).toEqual(["n"]);
    expect(useCiStatusStore.getState().byOid["n"].state).toBe("success");
    await vi.advanceTimersByTimeAsync(NONE_RECHECK_MS * 3);
    s.request("/r", ["n", "s"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(2);
  });

  it("caps the toast text for long errors", async () => {
    (tauri.invokeCiStatusForCommits as any).mockRejectedValue("HTTP 500 " + "x".repeat(2000));
    useCiStatusStore.getState().request("/r", ["a"]);
    await vi.advanceTimersByTimeAsync(350);
    const t = useToastStore.getState().toasts;
    expect(t).toHaveLength(1);
    expect(JSON.stringify(t[0]).length).toBeLessThan(400);
  });

  it("re-polls only pending oids", async () => {
    (tauri.invokeCiStatusForCommits as any)
      .mockResolvedValueOnce([ci("a", "pending"), ci("b", "success")])
      .mockResolvedValueOnce([ci("a", "success")]);
    useCiStatusStore.getState().request("/r", ["a", "b"]);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(CI_POLL_MS + 10);
    expect((tauri.invokeCiStatusForCommits as any).mock.calls[1][1]).toEqual(["a"]);
    expect(useCiStatusStore.getState().byOid["a"].state).toBe("success");
  });

  it("on failure degrades silently to no entry (no throw)", async () => {
    (tauri.invokeCiStatusForCommits as any).mockRejectedValue("failed to run gh");
    useCiStatusStore.getState().request("/r", ["a"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(useCiStatusStore.getState().byOid["a"]).toBeUndefined();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("toasts at most once per failure streak for non-gh errors", async () => {
    (tauri.invokeCiStatusForCommits as any).mockRejectedValue("HTTP 500 boom");
    useCiStatusStore.getState().request("/r", ["a"]);
    await vi.advanceTimersByTimeAsync(350);
    useCiStatusStore.getState().request("/r", ["b"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(2);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("switching repos clears old results and drops an in-flight response from the old repo", async () => {
    let resolveOld!: (v: any) => void;
    (tauri.invokeCiStatusForCommits as any)
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }))
      .mockResolvedValueOnce([ci("n")]);
    useCiStatusStore.getState().request("/old", ["o"]);
    await vi.advanceTimersByTimeAsync(350);
    useCiStatusStore.getState().request("/new", ["n"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(Object.keys(useCiStatusStore.getState().byOid)).toEqual(["n"]);
    resolveOld([ci("o", "pending")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.keys(useCiStatusStore.getState().byOid)).toEqual(["n"]);
    // no poll is scheduled for the old repo's pending result
    await vi.advanceTimersByTimeAsync(CI_POLL_MS + 10);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(2);
  });

  it("a debounced request for the old repo does not fire after switching repos", async () => {
    (tauri.invokeCiStatusForCommits as any).mockResolvedValue([ci("n")]);
    useCiStatusStore.getState().request("/old", ["o"]);
    useCiStatusStore.getState().request("/new", ["n"]);
    await vi.advanceTimersByTimeAsync(350);
    expect(tauri.invokeCiStatusForCommits).toHaveBeenCalledTimes(1);
    expect((tauri.invokeCiStatusForCommits as any).mock.calls[0]).toEqual(["/new", ["n"]]);
  });
});

describe("ciChecksStore", () => {
  beforeEach(() => { vi.clearAllMocks(); resetCiStatus(); useCiChecksStore.setState({ checks: null, error: null, loading: false, repoPath: null, oid: null } as any); });
  it("loads checks and classifies errors", async () => {
    (tauri.invokeCiCommitChecks as any).mockResolvedValueOnce({ oid: "a", runs: [], other: [] });
    await useCiChecksStore.getState().load("/r", "a");
    expect(useCiChecksStore.getState().checks?.oid).toBe("a");
    (tauri.invokeCiCommitChecks as any).mockRejectedValueOnce("HTTP 403: API rate limit exceeded");
    await useCiChecksStore.getState().load("/r", "b");
    expect(useCiChecksStore.getState().error?.kind).toBe("rate-limited");
  });
  it("rerun refreshes the open commit afterwards", async () => {
    (tauri.invokeCiCommitChecks as any).mockResolvedValue({ oid: "a", runs: [], other: [] });
    (tauri.invokeCiStatusForCommits as any).mockResolvedValue([ci("a")]);
    await useCiChecksStore.getState().load("/r", "a");
    await useCiChecksStore.getState().rerun(7, true);
    expect(tauri.invokeCiRerun).toHaveBeenCalledWith("/r", 7, true);
    expect(tauri.invokeCiCommitChecks).toHaveBeenCalledTimes(2);
  });
});
