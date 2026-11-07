import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UserCombobox from "../components/UserCombobox";

const options = ["alice", "bob", "carol"];

describe("UserCombobox", () => {
  it("shows 'Any' when no value is selected", () => {
    render(<UserCombobox value={undefined} onChange={vi.fn()} options={options} />);
    expect(screen.getByRole("button")).toHaveTextContent("Any");
  });

  it("shows the selected value on the trigger", () => {
    render(<UserCombobox value="bob" onChange={vi.fn()} options={options} />);
    expect(screen.getByRole("button")).toHaveTextContent("bob");
  });

  it("opens a popover listing all options on click", () => {
    render(<UserCombobox value={undefined} onChange={vi.fn()} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    options.forEach((o) => expect(screen.getByText(o)).toBeInTheDocument());
  });

  it("filters the list as the user types", () => {
    render(<UserCombobox value={undefined} onChange={vi.fn()} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Jump to user..."), { target: { value: "bo" } });
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
  });

  it("ranks substring matches before fuzzy-only matches", () => {
    const rankedOptions = ["bxoxb", "bob", "bobby"];
    const { container } = render(<UserCombobox value={undefined} onChange={vi.fn()} options={rankedOptions} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByPlaceholderText("Jump to user..."), { target: { value: "bob" } });
    const names = Array.from(container.querySelectorAll(".row-name")).map((el) => el.textContent);
    expect(names).toEqual(["Any", "bob", "bobby", "bxoxb"]);
  });

  it("calls onChange and closes when an option is clicked", () => {
    const onChange = vi.fn();
    render(<UserCombobox value={undefined} onChange={onChange} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("bob"));
    expect(onChange).toHaveBeenCalledWith("bob");
    expect(screen.queryByPlaceholderText("Jump to user...")).not.toBeInTheDocument();
  });

  it("calls onChange(null) when 'Any' is clicked", () => {
    const onChange = vi.fn();
    render(<UserCombobox value="bob" onChange={onChange} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Any"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selects the highlighted row on Enter", () => {
    const onChange = vi.fn();
    render(<UserCombobox value={undefined} onChange={onChange} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    const input = screen.getByPlaceholderText("Jump to user...");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("alice");
  });

  it("closes without calling onChange on Escape", () => {
    const onChange = vi.fn();
    render(<UserCombobox value={undefined} onChange={onChange} options={options} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(screen.getByPlaceholderText("Jump to user..."), { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Jump to user...")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <UserCombobox value={undefined} onChange={vi.fn()} options={options} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByPlaceholderText("Jump to user...")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByPlaceholderText("Jump to user...")).not.toBeInTheDocument();
  });

  it("shows a spinner and disables the trigger while loading", () => {
    render(<UserCombobox value={undefined} onChange={vi.fn()} options={[]} isLoading />);
    const trigger = screen.getByRole("button");
    expect(trigger).toBeDisabled();
    expect(trigger.querySelector(".animate-spin")).not.toBeNull();
  });

  it("tags the row matching the current value as current", () => {
    render(<UserCombobox value="bob" onChange={vi.fn()} options={options} />);
    fireEvent.click(screen.getByRole("button", { name: "bob" }));
    const row = screen.getByText("bob", { selector: ".row-name" }).closest("div");
    expect(row).toHaveTextContent("current");
  });
});
