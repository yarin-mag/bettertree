import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RefCombobox from "../components/RefCombobox";

describe("RefCombobox", () => {
  const branches = ["main", "develop"];
  const tags = ["v1.0.0", "v2.0.0"];

  it("shows the placeholder when nothing is picked", () => {
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={tags} placeholder="Base ref" />);
    expect(screen.getByText("Base ref")).toBeInTheDocument();
  });

  it("shows the picked value on the trigger button", () => {
    render(<RefCombobox value="main" onChange={vi.fn()} branches={branches} tags={tags} />);
    expect(screen.getByRole("button", { name: "main" })).toBeInTheDocument();
  });

  it("opens to show Branches and Tags sections", () => {
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    expect(screen.getByText("Branches")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("develop")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
  });

  it("filters both branches and tags by typed text", () => {
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.change(screen.getByPlaceholderText("Jump to branch or tag..."), { target: { value: "v2" } });
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.getByText("v2.0.0")).toBeInTheDocument();
    expect(screen.queryByText("v1.0.0")).not.toBeInTheDocument();
  });

  it("calls onChange and closes when a branch row is clicked", () => {
    const onChange = vi.fn();
    render(<RefCombobox value={null} onChange={onChange} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.click(screen.getByText("develop"));
    expect(onChange).toHaveBeenCalledWith("develop");
    expect(screen.queryByText("Branches")).not.toBeInTheDocument();
  });

  it("calls onChange when a tag row is clicked", () => {
    const onChange = vi.fn();
    render(<RefCombobox value={null} onChange={onChange} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.click(screen.getByText("v1.0.0"));
    expect(onChange).toHaveBeenCalledWith("v1.0.0");
  });

  it("selects the highlighted row on Enter", () => {
    const onChange = vi.fn();
    render(<RefCombobox value={null} onChange={onChange} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    const input = screen.getByPlaceholderText("Jump to branch or tag...");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("develop");
  });

  it("closes on Escape without calling onChange", () => {
    const onChange = vi.fn();
    render(<RefCombobox value={null} onChange={onChange} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.keyDown(screen.getByPlaceholderText("Jump to branch or tag..."), { key: "Escape" });
    expect(screen.queryByText("Branches")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a no-matches message only when the filter is empty and there's nothing to show", () => {
    render(<RefCombobox value={null} onChange={vi.fn()} branches={[]} tags={[]} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("offers a 'use as SHA/ref' option for text that matches no branch or tag", () => {
    const onChange = vi.fn();
    render(<RefCombobox value={null} onChange={onChange} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.change(screen.getByPlaceholderText("Jump to branch or tag..."), { target: { value: "abc1234" } });
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("abc1234"));
    expect(onChange).toHaveBeenCalledWith("abc1234");
  });

  it("does not offer a 'use as SHA/ref' option for text that exactly matches an existing branch", () => {
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={tags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.change(screen.getByPlaceholderText("Jump to branch or tag..."), { target: { value: branches[0] } });
    expect(screen.queryByText("use as SHA/ref")).not.toBeInTheDocument();
  });

  it("caps the number of rendered rows per section so a huge tag list doesn't jank the DOM on open", () => {
    const manyTags = Array.from({ length: 60 }, (_, i) => `v${i}.0.0`);
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={manyTags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    expect(screen.getAllByText(/^v\d+\.0\.0$/)).toHaveLength(50);
    expect(screen.getByText("+10 more — type to search")).toBeInTheDocument();
  });

  it("does not show the more-hint once typing narrows the list under the cap", () => {
    const manyTags = Array.from({ length: 60 }, (_, i) => `v${i}.0.0`);
    render(<RefCombobox value={null} onChange={vi.fn()} branches={branches} tags={manyTags} placeholder="Base ref" />);
    fireEvent.click(screen.getByRole("button", { name: "Base ref" }));
    fireEvent.change(screen.getByPlaceholderText("Jump to branch or tag..."), { target: { value: "v5.0.0" } });
    expect(screen.queryByText(/more — type to search/)).not.toBeInTheDocument();
    expect(screen.getByText("v5.0.0")).toBeInTheDocument();
  });
});
