import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../lib/branchActions", () => ({
  checkoutBranch: vi.fn().mockResolvedValue(undefined),
  copyWithToast: vi.fn().mockResolvedValue(undefined),
}));

import { checkoutBranch, copyWithToast } from "../lib/branchActions";
import { useWorkspaceStore } from "../store/workspaceStore";
import { recordRecentBranch } from "../lib/recentBranches";
import BranchSwitcher from "../components/BranchSwitcher";

const b = (name: string, isRemote = false, isHead = false) => ({ name, isRemote, isHead, targetOid: name });

function seed() {
  localStorage.clear();
  vi.clearAllMocks();
  useWorkspaceStore.setState({
    branches: [
      b("main"),
      b("feature/login", false, true),
      b("fix/crash"),
      b("origin/main", true),
      b("origin/feature/login", true),
      b("origin/only-remote", true),
    ],
  } as never);
}

const open = (chip = "feature/login", detached = false) => {
  render(<BranchSwitcher chipName={chip} detached={detached} />);
  fireEvent.click(screen.getByTestId("branch-chip"));
};
const search = () => screen.getByPlaceholderText("Jump to branch...") as HTMLInputElement;
const rowNames = () => Array.from(document.querySelectorAll("[data-branch-row] .row-name")).map((e) => e.textContent);

describe("BranchSwitcher", () => {
  beforeEach(seed);

  it("shows the current branch as a chip and keeps the dropdown closed", () => {
    render(<BranchSwitcher chipName="feature/login" detached={false} />);
    expect(screen.getByTestId("branch-chip")).toHaveTextContent("feature/login");
    expect(screen.queryByPlaceholderText("Jump to branch...")).toBeNull();
  });

  it("clicking the chip opens a dropdown with the search focused", () => {
    open();
    expect(search()).toHaveFocus();
  });

  it("lists local branches, then remote-only branches (not remotes that have a local copy)", () => {
    open();
    expect(rowNames()).toEqual(["main", "feature/login", "fix/crash", "origin/only-remote"]);
  });

  it("marks the current branch", () => {
    open();
    expect(screen.getByText("current")).toBeInTheDocument();
  });

  it("typing fuzzy-filters the list", () => {
    open();
    fireEvent.change(search(), { target: { value: "crash" } });
    expect(rowNames()).toEqual(["fix/crash"]);
  });

  it("shows an empty state when nothing matches", () => {
    open();
    fireEvent.change(search(), { target: { value: "zzzzzz" } });
    expect(screen.getByText("No matching branches")).toBeInTheDocument();
  });

  it("Enter switches to the highlighted branch and closes", () => {
    open();
    fireEvent.change(search(), { target: { value: "crash" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(checkoutBranch).toHaveBeenCalledWith("fix/crash", false);
    expect(screen.queryByPlaceholderText("Jump to branch...")).toBeNull();
  });

  it("arrow keys move the highlight", () => {
    open();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(search(), { key: "ArrowDown" }); // main → feature → fix → only-remote
    fireEvent.keyDown(search(), { key: "ArrowUp" }); // → fix
    fireEvent.keyDown(search(), { key: "Enter" });
    expect(checkoutBranch).toHaveBeenCalledWith("fix/crash", false);
  });

  it("clicking a row switches to it", () => {
    open();
    fireEvent.click(screen.getByText("fix/crash"));
    expect(checkoutBranch).toHaveBeenCalledWith("fix/crash", false);
  });

  it("a remote-only branch is checked out as a remote", () => {
    open();
    fireEvent.click(screen.getByText("origin/only-remote"));
    expect(checkoutBranch).toHaveBeenCalledWith("origin/only-remote", true);
  });

  it("choosing the current branch just closes the dropdown", () => {
    open();
    fireEvent.click(screen.getAllByText("feature/login")[1]);
    expect(checkoutBranch).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Jump to branch...")).toBeNull();
  });

  it("Escape and an outside click close it without switching", () => {
    open();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(screen.queryByPlaceholderText("Jump to branch...")).toBeNull();

    fireEvent.click(screen.getByTestId("branch-chip"));
    expect(search()).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByPlaceholderText("Jump to branch...")).toBeNull();
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it("clicking the chip again closes it, and reopening starts with a clean search", () => {
    open();
    fireEvent.change(search(), { target: { value: "crash" } });
    fireEvent.click(screen.getByTestId("branch-chip"));
    expect(screen.queryByPlaceholderText("Jump to branch...")).toBeNull();
    fireEvent.click(screen.getByTestId("branch-chip"));
    expect(search().value).toBe("");
  });

  it("lists recent branches first when the search is empty", () => {
    recordRecentBranch("fix/crash");
    open();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(rowNames()[0]).toBe("fix/crash");
    expect(rowNames().filter((n) => n === "fix/crash")).toHaveLength(1);
  });

  it("records the choice as a recent branch", () => {
    open();
    fireEvent.click(screen.getByText("fix/crash"));
    expect(JSON.parse(localStorage.getItem("bettertree.recentBranches")!)).toEqual(["fix/crash"]);
  });

  it("has a button that copies the current branch name", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Copy branch name" }));
    expect(copyWithToast).toHaveBeenCalledWith("feature/login", "branch name");
  });

  it("works from a detached HEAD: every branch is selectable and there is no copy button", () => {
    open("detached @ abc1234", true);
    expect(screen.queryByText("current")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy branch name" })).toBeNull();
    fireEvent.click(screen.getAllByText("feature/login")[0]);
    expect(checkoutBranch).toHaveBeenCalledWith("feature/login", false);
  });
});
