import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextMenu } from "../components/ContextMenu";

function setup() {
  const onClose = vi.fn();
  const onA = vi.fn();
  render(
    <div>
      <button>outside</button>
      <ContextMenu
        x={10}
        y={10}
        onClose={onClose}
        items={[
          { label: "A", onSelect: onA },
          { label: "B", onSelect: vi.fn(), disabled: true },
          { label: "C", onSelect: vi.fn() },
        ]}
      />
    </div>
  );
  return { onClose, onA };
}

describe("ContextMenu", () => {
  it("focuses the first item and runs onSelect then closes on click", () => {
    const { onClose, onA } = setup();
    expect(screen.getByRole("menuitem", { name: "A" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitem", { name: "A" }));
    expect(onA).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("arrow keys skip disabled items", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "C" })).toHaveFocus();
  });

  it("closes on Escape, outside mousedown and scroll", () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByText("outside"));
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("does not close on mousedown inside the menu", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "A" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
