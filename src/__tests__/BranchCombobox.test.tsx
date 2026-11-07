import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BranchCombobox from "../components/BranchCombobox";
import { getRecentBranches, recordRecentBranch } from "../lib/recentBranches";

const branches = ["main", "develop", "feature/foo"];

describe("BranchCombobox", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows 'Any' when no value is selected", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    expect(screen.getByRole("button")).toHaveTextContent("Any");
  });

  it("shows the selected value on the trigger", () => {
    render(<BranchCombobox value="develop" onChange={vi.fn()} branches={branches} />);
    expect(screen.getByRole("button")).toHaveTextContent("develop");
  });

  it("opens a popover listing all branches on click", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    branches.forEach((b) => expect(screen.getByText(b)).toBeInTheDocument());
  });

  it("filters the list as the user types", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Jump to branch..."), { target: { value: "dev" } });
    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("calls onChange and closes when a branch is clicked", () => {
    const onChange = vi.fn();
    render(<BranchCombobox value={undefined} onChange={onChange} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("develop"));
    expect(onChange).toHaveBeenCalledWith("develop");
    expect(screen.queryByPlaceholderText("Jump to branch...")).not.toBeInTheDocument();
  });

  it("calls onChange(null) when 'Any' is clicked", () => {
    const onChange = vi.fn();
    render(<BranchCombobox value="develop" onChange={onChange} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Any"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selects the highlighted row on Enter", () => {
    const onChange = vi.fn();
    render(<BranchCombobox value={undefined} onChange={onChange} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByPlaceholderText("Jump to branch...");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("main");
  });

  it("closes without calling onChange on Escape", () => {
    const onChange = vi.fn();
    render(<BranchCombobox value={undefined} onChange={onChange} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(screen.getByPlaceholderText("Jump to branch..."), { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Jump to branch...")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByPlaceholderText("Jump to branch...")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByPlaceholderText("Jump to branch...")).not.toBeInTheDocument();
  });

  it("shows a spinner and disables the trigger while loading", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={[]} isLoading />);
    const trigger = screen.getByRole("button");
    expect(trigger).toBeDisabled();
    expect(trigger.querySelector(".animate-spin")).not.toBeNull();
  });

  it("does not show a spinner or disable the trigger once loaded", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} isLoading={false} />);
    const trigger = screen.getByRole("button");
    expect(trigger).not.toBeDisabled();
    expect(trigger.querySelector(".animate-spin")).toBeNull();
  });

  it("shows keyboard hints in the footer", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/navigate/)).toBeInTheDocument();
    expect(screen.getByText(/select/)).toBeInTheDocument();
    expect(screen.getByText(/close/)).toBeInTheDocument();
  });

  it("tags the row matching the current value as current", () => {
    render(<BranchCombobox value="develop" onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button", { name: "develop" }));
    const row = screen.getByText("develop", { selector: ".row-name" }).closest("[data-branch-row]");
    expect(row).toHaveTextContent("current");
  });

  it("shows a Recent section above the full list when recents exist", () => {
    recordRecentBranch("feature/foo");
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("omits the Recent section when there are no recents", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
  });

  it("records a branch as recent when it's selected", () => {
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("develop"));
    expect(getRecentBranches()).toEqual(["develop"]);
  });

  it("keeps the full list visible even when a Recent section is shown", () => {
    recordRecentBranch("feature/foo");
    render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={branches} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByText("feature/foo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("develop")).toBeInTheDocument();
  });

  it("ranks substring matches before fuzzy-only matches", () => {
    const rankedBranches = ["moxbxilxe", "mobile", "release/mobile-v2"];
    const { container } = render(<BranchCombobox value={undefined} onChange={vi.fn()} branches={rankedBranches} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Jump to branch..."), { target: { value: "mobile" } });
    const names = Array.from(container.querySelectorAll(".row-name")).map((el) => el.textContent);
    expect(names).toEqual(["Any", "mobile", "release/mobile-v2", "moxbxilxe"]);
  });
});
