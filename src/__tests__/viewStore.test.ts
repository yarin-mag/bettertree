import { describe, it, expect, beforeEach } from "vitest";
import { useViewStore } from "../store/viewStore";

describe("viewStore", () => {
  beforeEach(() => {
    useViewStore.setState({ activeView: "repo" });
  });

  it("defaults to the repo view", () => {
    expect(useViewStore.getState().activeView).toBe("repo");
  });

  it("setActiveView switches to pulls", () => {
    useViewStore.getState().setActiveView("pulls");
    expect(useViewStore.getState().activeView).toBe("pulls");
  });

  it("setActiveView switches to actions", () => {
    useViewStore.getState().setActiveView("actions");
    expect(useViewStore.getState().activeView).toBe("actions");
  });
});
