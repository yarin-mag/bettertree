import { describe, it, expect, beforeEach, vi } from "vitest";
import { MODAL_MIN, defaultModalSize, clampModalSize, maxModalSize } from "../lib/modalLayout";

describe("modal sizing helpers", () => {
  const view = { w: 1600, h: 1000 };

  it("allows up to the viewport minus a margin on each side", () => {
    expect(maxModalSize(view)).toEqual({ w: 1552, h: 952 });
  });

  it("defaults to a wide, tall modal (capped at 1152 wide)", () => {
    expect(defaultModalSize(view)).toEqual({ w: 1152, h: 952 });
    expect(defaultModalSize({ w: 800, h: 600 })).toEqual({ w: 752, h: 552 });
  });

  it("clamps between the minimum and what fits in the window", () => {
    expect(clampModalSize({ w: 100, h: 100 }, view)).toEqual(MODAL_MIN);
    expect(clampModalSize({ w: 5000, h: 5000 }, view)).toEqual({ w: 1552, h: 952 });
    expect(clampModalSize({ w: 900.4, h: 600.6 }, view)).toEqual({ w: 900, h: 601 });
  });

  it("never goes below the minimum even in a tiny window", () => {
    expect(clampModalSize({ w: 700, h: 700 }, { w: 400, h: 300 })).toEqual(MODAL_MIN);
  });
});

describe("modal layout store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("starts with the default size, not fullscreen", async () => {
    const { useModalLayoutStore } = await import("../store/modalLayoutStore");
    expect(useModalLayoutStore.getState()).toMatchObject({ size: null, fullscreen: false });
  });

  it("remembers size and fullscreen across reloads", async () => {
    const first = await import("../store/modalLayoutStore");
    first.useModalLayoutStore.getState().setSize({ w: 900, h: 700 });
    first.useModalLayoutStore.getState().toggleFullscreen();

    vi.resetModules();
    const second = await import("../store/modalLayoutStore");
    expect(second.useModalLayoutStore.getState()).toMatchObject({ size: { w: 900, h: 700 }, fullscreen: true });
  });

  it("resetSize goes back to the default but keeps fullscreen as is", async () => {
    const { useModalLayoutStore } = await import("../store/modalLayoutStore");
    useModalLayoutStore.getState().setSize({ w: 900, h: 700 });
    useModalLayoutStore.getState().resetSize();
    expect(useModalLayoutStore.getState().size).toBeNull();
  });

  it("ignores corrupt or unreadable stored data", async () => {
    localStorage.setItem("bettertree.commitModal.layout", "{not json");
    const a = await import("../store/modalLayoutStore");
    expect(a.useModalLayoutStore.getState()).toMatchObject({ size: null, fullscreen: false });

    vi.resetModules();
    localStorage.setItem("bettertree.commitModal.layout", JSON.stringify({ size: { w: "x", h: NaN }, fullscreen: "yes" }));
    const b = await import("../store/modalLayoutStore");
    expect(b.useModalLayoutStore.getState()).toMatchObject({ size: null, fullscreen: false });

    vi.resetModules();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const c = await import("../store/modalLayoutStore");
    expect(c.useModalLayoutStore.getState()).toMatchObject({ size: null, fullscreen: false });
    spy.mockRestore();
  });
});
