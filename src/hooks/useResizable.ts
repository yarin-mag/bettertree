import { useCallback, useRef, useState } from "react";

export function useResizable(
  initial: number,
  min: number,
  max: number,
  axis: "x" | "y",
  invert = false
) {
  const [size, setSize] = useState(initial);
  const startRef = useRef({ pos: 0, size: 0 });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startRef.current = { pos: axis === "x" ? e.clientX : e.clientY, size };
      const cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const pos = axis === "x" ? ev.clientX : ev.clientY;
        const delta = pos - startRef.current.pos;
        const next = startRef.current.size + (invert ? -delta : delta);
        setSize(Math.min(max, Math.max(min, next)));
      };
      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [axis, invert, min, max, size]
  );

  return { size, onMouseDown };
}
