import { describe, it, expect, beforeEach } from "vitest";
import { useBranchScopeStore } from "../store/branchScopeStore";

describe("branchScopeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useBranchScopeStore.setState({ showRemoteBranches: true });
  });

  it("defaults to showing remote branches", () => {
    expect(useBranchScopeStore.getState().showRemoteBranches).toBe(true);
  });

  it("toggleShowRemoteBranches flips false and back to true", () => {
    useBranchScopeStore.getState().toggleShowRemoteBranches();
    expect(useBranchScopeStore.getState().showRemoteBranches).toBe(false);
    useBranchScopeStore.getState().toggleShowRemoteBranches();
    expect(useBranchScopeStore.getState().showRemoteBranches).toBe(true);
  });

  it("persists the choice to localStorage", () => {
    useBranchScopeStore.getState().toggleShowRemoteBranches();
    expect(localStorage.getItem("branchScope.showRemoteBranches")).toBe("false");
  });
});
