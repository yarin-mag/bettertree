import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ResizableModal from "../components/ResizableModal";
import { useModalLayoutStore } from "../store/modalLayoutStore";

function setViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true, writable: true });
}

function drag(handle: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.mouseDown(handle, { clientX: from[0], clientY: from[1] });
  fireEvent.mouseMove(window, { clientX: to[0], clientY: to[1] });
  fireEvent.mouseUp(window);
}

const panel = () => screen.getByRole("dialog");
const size = () => ({ w: parseInt(panel().style.width), h: parseInt(panel().style.height) });

function setup(onClose = vi.fn()) {
  render(
    <ResizableModal onClose={onClose} label="Commit" header={<div>HEADER <button>inner</button></div>}>
      <div>BODY</div>
    </ResizableModal>
  );
  return onClose;
}

describe("ResizableModal", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewport(1600, 1000);
    useModalLayoutStore.setState({ size: null, fullscreen: false });
  });

  it("renders the header and body in a dialog sized to the default", () => {
    setup();
    expect(screen.getByText("HEADER", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("BODY")).toBeInTheDocument();
    expect(size()).toEqual({ w: 1152, h: 952 });
  });

  it("closes from the X button and from a backdrop click, not from clicks inside", () => {
    const onClose = setup();
    fireEvent.click(screen.getByText("BODY"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const backdrop = screen.getByTestId("modal-backdrop");
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close when a drag that started inside ends outside the panel", () => {
    const onClose = setup();
    const backdrop = screen.getByTestId("modal-backdrop");
    fireEvent.mouseDown(screen.getByText("BODY"));
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    fireEvent.mouseDown(screen.getByTestId("resize-e"), { clientX: 1000, clientY: 500 });
    fireEvent.mouseMove(window, { clientX: 1100, clientY: 500 });
    fireEvent.mouseUp(window);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("the full-screen button fills the window and toggles back", () => {
    setup();
    expect(panel()).toHaveAttribute("data-fullscreen", "false");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(panel()).toHaveAttribute("data-fullscreen", "true");
    expect(panel().style.width).toBe("100vw");
    expect(panel().style.height).toBe("100vh");
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(panel()).toHaveAttribute("data-fullscreen", "false");
    expect(size()).toEqual({ w: 1152, h: 952 });
  });

  it("double-clicking the header toggles full screen, but not when double-clicking a button in it", () => {
    setup();
    fireEvent.doubleClick(screen.getByText("HEADER", { exact: false }));
    expect(panel()).toHaveAttribute("data-fullscreen", "true");
    fireEvent.doubleClick(screen.getByRole("button", { name: "inner" }));
    expect(panel()).toHaveAttribute("data-fullscreen", "true");
    fireEvent.doubleClick(screen.getByText("HEADER", { exact: false }));
    expect(panel()).toHaveAttribute("data-fullscreen", "false");
  });

  it("dragging the right edge resizes around the center (2x the pointer movement)", () => {
    setup();
    drag(screen.getByTestId("resize-e"), [1000, 500], [900, 500]);
    expect(size()).toEqual({ w: 952, h: 952 });
  });

  it("dragging the left edge outward grows the modal", () => {
    setup();
    act(() => useModalLayoutStore.getState().setSize({ w: 800, h: 600 }));
    drag(screen.getByTestId("resize-w"), [400, 500], [350, 500]);
    expect(size()).toEqual({ w: 900, h: 600 });
  });

  it("corners resize both dimensions at once", () => {
    setup();
    act(() => useModalLayoutStore.getState().setSize({ w: 800, h: 600 }));
    drag(screen.getByTestId("resize-se"), [1000, 800], [1050, 830]);
    expect(size()).toEqual({ w: 900, h: 660 });
  });

  it("top and bottom edges change only the height", () => {
    setup();
    act(() => useModalLayoutStore.getState().setSize({ w: 800, h: 600 }));
    drag(screen.getByTestId("resize-n"), [800, 100], [800, 150]);
    expect(size()).toEqual({ w: 800, h: 500 });
  });

  it("cannot be dragged smaller than the minimum or larger than the window allows", () => {
    setup();
    drag(screen.getByTestId("resize-e"), [1000, 500], [0, 500]);
    expect(size().w).toBe(480);
    drag(screen.getByTestId("resize-se"), [100, 100], [5000, 5000]);
    expect(size()).toEqual({ w: 1552, h: 952 });
  });

  it("shows Reset size only after resizing, and it restores the default", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Reset size" })).toBeNull();
    drag(screen.getByTestId("resize-e"), [1000, 500], [900, 500]);
    fireEvent.click(screen.getByRole("button", { name: "Reset size" }));
    expect(size()).toEqual({ w: 1152, h: 952 });
    expect(screen.queryByRole("button", { name: "Reset size" })).toBeNull();
  });

  it("remembers the size for the next time it opens", () => {
    const { unmount } = render(
      <ResizableModal onClose={() => {}} label="Commit" header={<div>H</div>}>
        <div>B</div>
      </ResizableModal>
    );
    drag(screen.getAllByTestId("resize-e")[0], [1000, 500], [900, 500]);
    unmount();
    render(
      <ResizableModal onClose={() => {}} label="Commit" header={<div>H</div>}>
        <div>B</div>
      </ResizableModal>
    );
    expect(size().w).toBe(952);
  });

  it("clamps a remembered size that no longer fits a smaller window", () => {
    useModalLayoutStore.setState({ size: { w: 1500, h: 900 } });
    setViewport(900, 700);
    setup();
    expect(size()).toEqual({ w: 852, h: 652 });
  });

  it("follows the window when it is resized", () => {
    setup();
    act(() => {
      setViewport(900, 700);
      window.dispatchEvent(new Event("resize"));
    });
    expect(size()).toEqual({ w: 852, h: 652 });
  });

  it("hides the resize handles in full screen", () => {
    useModalLayoutStore.setState({ fullscreen: true });
    setup();
    expect(screen.queryByTestId("resize-e")).toBeNull();
  });
});
