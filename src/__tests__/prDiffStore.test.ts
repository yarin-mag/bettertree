import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeGetPrDiff: vi.fn(),
  invokeListPrReviewComments: vi.fn(),
  invokeAddPrReviewComment: vi.fn(),
}));

import { usePrDiffStore } from "../store/prDiffStore";
import * as tauriLib from "../lib/tauri";

describe("prDiffStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePrDiffStore.setState({ diff: null, reviewComments: [], isLoadingDiff: false });
  });

  it("loadDiff populates diff and reviewComments", async () => {
    (tauriLib.invokeGetPrDiff as any).mockResolvedValue({
      baseOid: "b1",
      headOid: "h1",
      files: [{ path: "a.ts", status: "modified", lines: [], insertions: 1, deletions: 0 }],
    });
    (tauriLib.invokeListPrReviewComments as any).mockResolvedValue([
      { id: 1, author: "avery", body: "hi", createdAt: "now", path: "a.ts", line: 5, side: "RIGHT", url: "u" },
    ]);

    await usePrDiffStore.getState().loadDiff("/tmp/a", 42, "main");

    expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledWith("/tmp/a", 42, "main");
    expect(tauriLib.invokeListPrReviewComments).toHaveBeenCalledWith("/tmp/a", 42);
    expect(usePrDiffStore.getState().diff?.baseOid).toBe("b1");
    expect(usePrDiffStore.getState().reviewComments).toHaveLength(1);
  });

  it("loadDiff sets isLoadingDiff while in flight", async () => {
    let resolveFn: (v: any) => void;
    (tauriLib.invokeGetPrDiff as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    (tauriLib.invokeListPrReviewComments as any).mockResolvedValue([]);

    const promise = usePrDiffStore.getState().loadDiff("/tmp/a", 42, "main");
    expect(usePrDiffStore.getState().isLoadingDiff).toBe(true);
    resolveFn!({ baseOid: "b", headOid: "h", files: [] });
    await promise;
    expect(usePrDiffStore.getState().isLoadingDiff).toBe(false);
  });

  it("addReviewComment posts and appends", async () => {
    (tauriLib.invokeAddPrReviewComment as any).mockResolvedValue({
      id: 2,
      author: "yarinmag",
      body: "thanks",
      createdAt: "now",
      path: "a.ts",
      line: 5,
      side: "RIGHT",
      url: "u",
    });

    await usePrDiffStore.getState().addReviewComment("/tmp/a", 42, "a.ts", 5, "RIGHT", "thanks");

    expect(tauriLib.invokeAddPrReviewComment).toHaveBeenCalledWith("/tmp/a", 42, "a.ts", 5, "RIGHT", "thanks");
    expect(usePrDiffStore.getState().reviewComments).toHaveLength(1);
  });

  it("clearDiff resets diff and reviewComments", () => {
    usePrDiffStore.setState({
      diff: { baseOid: "b", headOid: "h", files: [] },
      reviewComments: [{ id: 1 } as any],
    });

    usePrDiffStore.getState().clearDiff();

    expect(usePrDiffStore.getState().diff).toBeNull();
    expect(usePrDiffStore.getState().reviewComments).toEqual([]);
  });
});
