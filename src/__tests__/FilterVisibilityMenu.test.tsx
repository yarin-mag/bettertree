import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterVisibilityMenu from "../components/FilterVisibilityMenu";

const filters = [
  { key: "author", label: "Author" },
  { key: "sort", label: "Sort" },
];

describe("FilterVisibilityMenu", () => {
  it("opens a popover listing every filter as a checkbox with the right checked state", () => {
    render(<FilterVisibilityMenu filters={filters} visible={["sort"]} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByLabelText("Author")).not.toBeChecked();
    expect(screen.getByLabelText("Sort")).toBeChecked();
  });

  it("calls onToggle with the clicked filter's key", () => {
    const onToggle = vi.fn();
    render(<FilterVisibilityMenu filters={filters} visible={["sort"]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Author"));
    expect(onToggle).toHaveBeenCalledWith("author");
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <FilterVisibilityMenu filters={filters} visible={["sort"]} onToggle={vi.fn()} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByLabelText("Author")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByLabelText("Author")).not.toBeInTheDocument();
  });
});
