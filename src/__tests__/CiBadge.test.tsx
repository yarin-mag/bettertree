import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CiBadge from "../components/CiBadge";

describe("CiBadge", () => {
  it("renders nothing when there is no CI", () => {
    const { container } = render(<CiBadge state="none" />);
    expect(container).toBeEmptyDOMElement();
  });
  it.each([["success", "CI passed"], ["failure", "CI failed"], ["pending", "CI running"]])("labels %s", (state, label) => {
    render(<CiBadge state={state as any} />);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });
  it("calls onClick without bubbling to the row", () => {
    const onClick = vi.fn(); const rowClick = vi.fn();
    render(<div onClick={rowClick}><CiBadge state="failure" onClick={onClick} /></div>);
    fireEvent.click(screen.getByLabelText("CI failed"));
    expect(onClick).toHaveBeenCalled();
    expect(rowClick).not.toHaveBeenCalled();
  });
});
