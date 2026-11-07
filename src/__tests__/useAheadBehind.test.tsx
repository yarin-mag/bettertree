import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";

vi.mock("../lib/tauri", () => ({ invokeGetAheadBehind: vi.fn() }));
import * as tauriLib from "../lib/tauri";
import { useAheadBehind } from "../hooks/useAheadBehind";

const mock = tauriLib.invokeGetAheadBehind as unknown as ReturnType<typeof vi.fn>;

describe("useAheadBehind", () => {
  beforeEach(() => {
    mock.mockReset();
    useWorkspaceStore.setState({ branches: [], headOid: "a" });
  });

  it("loads for the repo and returns the result", async () => {
    mock.mockResolvedValue({ ahead: 1, behind: 2, upstream: "origin/main" });
    const { result } = renderHook(() => useAheadBehind("/r"));
    await waitFor(() => expect(result.current).toEqual({ ahead: 1, behind: 2, upstream: "origin/main" }));
    expect(mock).toHaveBeenCalledWith("/r");
  });

  it("reloads when headOid or branches change", async () => {
    mock.mockResolvedValue(null);
    renderHook(() => useAheadBehind("/r"));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    act(() => useWorkspaceStore.setState({ headOid: "b" }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    act(() => useWorkspaceStore.setState({ branches: [] }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(3));
  });

  it("is silent and null on failure", async () => {
    mock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAheadBehind("/r"));
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("returns null without a repo and does not call the backend", () => {
    const { result } = renderHook(() => useAheadBehind(undefined));
    expect(result.current).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("ignores a stale response after switching repos", async () => {
    let resolveA!: (v: unknown) => void;
    mock.mockImplementationOnce(() => new Promise((r) => (resolveA = r)));
    mock.mockResolvedValueOnce({ ahead: 0, behind: 5, upstream: "origin/b" });
    const { result, rerender } = renderHook(({ p }) => useAheadBehind(p), { initialProps: { p: "/a" as string | undefined } });
    rerender({ p: "/b" });
    await waitFor(() => expect(result.current?.upstream).toBe("origin/b"));
    await act(async () => resolveA({ ahead: 9, behind: 9, upstream: "origin/a" }));
    expect(result.current?.upstream).toBe("origin/b");
  });
});
