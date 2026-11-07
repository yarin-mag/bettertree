import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TruncatedBadge from "../components/TruncatedBadge";

function setWidths(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
}

describe("TruncatedBadge", () => {
  it("shows a tooltip with the full name only when truncated", () => {
    render(<TruncatedBadge name="a-very-long-branch-name" className="x" />);
    const badge = screen.getByText("a-very-long-branch-name");
    setWidths(badge, 100, 100);
    fireEvent.mouseEnter(badge);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    setWidths(badge, 200, 100);
    fireEvent.mouseEnter(badge);
    expect(screen.getByRole("tooltip")).toHaveTextContent("a-very-long-branch-name");
    fireEvent.mouseLeave(badge);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("calls onClick without bubbling", () => {
    let outer = 0;
    let inner = 0;
    render(
      <div onClick={() => outer++}>
        <TruncatedBadge name="n" className="x" onClick={() => inner++} />
      </div>
    );
    fireEvent.click(screen.getByText("n"));
    expect(inner).toBe(1);
    expect(outer).toBe(0);
  });

  it("applies a custom max width class", () => {
    render(<TruncatedBadge name="n" className="x" maxWidthClass="max-w-[16rem]" />);
    expect(screen.getByText("n").className).toContain("max-w-[16rem]");
  });
});
