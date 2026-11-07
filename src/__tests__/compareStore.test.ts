import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeCompareRefs: vi.fn(),
}));

import { useCompareStore } from "../store/compareStore";
import * as tauriLib from "../lib/tauri";

describe("compareStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompareStore.setState({
      baseRef: null,
      compareRef: null,
      result: null,
      isLoading: false,
      error: null,
    });
  });

  it("defaults to no refs picked and no result", () => {
    const state = useCompareStore.getState();
    expect(state.baseRef).toBeNull();
    expect(state.compareRef).toBeNull();
    expect(state.result).toBeNull();
  });

  it("setBaseRef and setCompareRef update the picked refs", () => {
    useCompareStore.getState().setBaseRef("v1.0");
    useCompareStore.getState().setCompareRef("v2.0");
    expect(useCompareStore.getState().baseRef).toBe("v1.0");
    expect(useCompareStore.getState().compareRef).toBe("v2.0");
  });

  it("loadCompare does nothing until both refs are picked", async () => {
    useCompareStore.setState({ baseRef: "v1.0", compareRef: null });
    await useCompareStore.getState().loadCompare("/tmp/a");
    expect(tauriLib.invokeCompareRefs).not.toHaveBeenCalled();
  });

  it("loadCompare fetches and stores the result once both refs are set", async () => {
    const sampleResult = {
      baseOid: "b",
      compareOid: "c",
      mergeBaseOid: "m",
      onlyInBase: [],
      onlyInCompare: [{ oid: "c1", summary: "new work", author: "a", timestamp: 100 }],
      graph: [],
    };
    (tauriLib.invokeCompareRefs as any).mockResolvedValue(sampleResult);
    useCompareStore.setState({ baseRef: "v1.0", compareRef: "v2.0" });

    await useCompareStore.getState().loadCompare("/tmp/a");

    expect(tauriLib.invokeCompareRefs).toHaveBeenCalledWith("/tmp/a", "v1.0", "v2.0");
    expect(useCompareStore.getState().result).toEqual(sampleResult);
  });

  it("sets isLoading while the request is in flight", async () => {
    let resolveFn: (value: any) => void;
    (tauriLib.invokeCompareRefs as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    useCompareStore.setState({ baseRef: "v1.0", compareRef: "v2.0" });

    const promise = useCompareStore.getState().loadCompare("/tmp/a");
    expect(useCompareStore.getState().isLoading).toBe(true);
    resolveFn!({ baseOid: "b", compareOid: "c", mergeBaseOid: null, onlyInBase: [], onlyInCompare: [], graph: [] });
    await promise;
    expect(useCompareStore.getState().isLoading).toBe(false);
  });

  it("stores an error message and clears any prior result on failure", async () => {
    (tauriLib.invokeCompareRefs as any).mockRejectedValue("ref 'v9.9' not found");
    useCompareStore.setState({ baseRef: "v1.0", compareRef: "v9.9" });

    await useCompareStore.getState().loadCompare("/tmp/a");

    expect(useCompareStore.getState().error).toBe("ref 'v9.9' not found");
    expect(useCompareStore.getState().result).toBeNull();
  });
});
