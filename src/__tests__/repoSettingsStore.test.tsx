import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeGetRepoSettings: vi.fn(),
  invokeSetRepoSettings: vi.fn(),
  invokeResetRepoSettings: vi.fn(),
}));

import * as tauri from "../lib/tauri";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useRepoSettings } from "../hooks/useRepoSettings";
import { useToastStore } from "../store/toastStore";

const custom = { ticketPattern: "ABC-\\d+", jiraBaseUrl: "https://j.example.com/", worktreeDir: "/wt", releaseTagPattern: "rel-*" };

describe("repoSettingsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRepoSettingsStore.setState({ byPath: {} });
    useToastStore.setState({ toasts: [] });
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(custom);
    vi.mocked(tauri.invokeSetRepoSettings).mockImplementation(async (_p, s) => s);
    vi.mocked(tauri.invokeResetRepoSettings).mockResolvedValue(undefined);
  });

  it("loads once per path and caches", async () => {
    await useRepoSettingsStore.getState().load("/r");
    await useRepoSettingsStore.getState().load("/r");
    expect(tauri.invokeGetRepoSettings).toHaveBeenCalledTimes(1);
    expect(useRepoSettingsStore.getState().byPath["/r"]).toEqual(custom);
  });

  it("shares one in-flight load between concurrent callers and toasts a failure once", async () => {
    vi.mocked(tauri.invokeGetRepoSettings).mockRejectedValue("db locked");
    await Promise.all([
      useRepoSettingsStore.getState().load("/r"),
      useRepoSettingsStore.getState().load("/r"),
      useRepoSettingsStore.getState().load("/r"),
    ]);
    expect(tauri.invokeGetRepoSettings).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("a slow load that resolves after a save does not overwrite the saved value", async () => {
    let resolveLoad!: (v: typeof custom) => void;
    vi.mocked(tauri.invokeGetRepoSettings).mockReturnValue(new Promise((r) => (resolveLoad = r)));
    const loading = useRepoSettingsStore.getState().load("/r");

    const saved = { ...custom, ticketPattern: "NEW-\\d+" };
    await useRepoSettingsStore.getState().save("/r", saved);
    resolveLoad(custom);
    await loading;

    expect(useRepoSettingsStore.getState().byPath["/r"]).toEqual(saved);
  });

  it("falls back to defaults and toasts when loading fails", async () => {
    vi.mocked(tauri.invokeGetRepoSettings).mockRejectedValue("db locked");
    await useRepoSettingsStore.getState().load("/r");
    expect(useRepoSettingsStore.getState().byPath["/r"]).toEqual(DEFAULT_REPO_SETTINGS);
    expect(useToastStore.getState().toasts[0].message).toContain("db locked");
  });

  it("save stores the value the backend returns (it may normalize)", async () => {
    vi.mocked(tauri.invokeSetRepoSettings).mockResolvedValue({ ...custom, jiraBaseUrl: "https://j.example.com/browse/" });
    const saved = await useRepoSettingsStore.getState().save("/r", { ...custom, jiraBaseUrl: "https://j.example.com/browse" });
    expect(saved.jiraBaseUrl).toBe("https://j.example.com/browse/");
    expect(useRepoSettingsStore.getState().byPath["/r"].jiraBaseUrl).toBe("https://j.example.com/browse/");
  });

  it("save rethrows backend errors and keeps the old value", async () => {
    useRepoSettingsStore.setState({ byPath: { "/r": custom } });
    vi.mocked(tauri.invokeSetRepoSettings).mockRejectedValue("bad url");
    await expect(useRepoSettingsStore.getState().save("/r", DEFAULT_REPO_SETTINGS)).rejects.toBe("bad url");
    expect(useRepoSettingsStore.getState().byPath["/r"]).toEqual(custom);
  });

  it("reset restores defaults", async () => {
    useRepoSettingsStore.setState({ byPath: { "/r": custom } });
    await useRepoSettingsStore.getState().reset("/r");
    expect(tauri.invokeResetRepoSettings).toHaveBeenCalledWith("/r");
    expect(useRepoSettingsStore.getState().byPath["/r"]).toEqual(DEFAULT_REPO_SETTINGS);
  });
});

describe("useRepoSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRepoSettingsStore.setState({ byPath: {} });
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(custom);
  });

  it("returns defaults first, then the stored settings", async () => {
    const { result } = renderHook(() => useRepoSettings("/r"));
    expect(result.current).toEqual(DEFAULT_REPO_SETTINGS);
    await waitFor(() => expect(result.current).toEqual(custom));
  });

  it("returns defaults and loads nothing without a path", () => {
    const { result } = renderHook(() => useRepoSettings(null));
    expect(result.current).toEqual(DEFAULT_REPO_SETTINGS);
    expect(tauri.invokeGetRepoSettings).not.toHaveBeenCalled();
  });

  it("updates when the store changes", async () => {
    const { result } = renderHook(() => useRepoSettings("/r"));
    await waitFor(() => expect(result.current).toEqual(custom));
    act(() => useRepoSettingsStore.setState({ byPath: { "/r": DEFAULT_REPO_SETTINGS } }));
    expect(result.current).toEqual(DEFAULT_REPO_SETTINGS);
  });
});
