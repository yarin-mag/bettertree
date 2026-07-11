interface ResizeHandleProps {
  axis: "x" | "y";
  onMouseDown: (e: React.MouseEvent) => void;
  edge: "start" | "end";
}

export default function ResizeHandle({ axis, onMouseDown, edge }: ResizeHandleProps) {
  const isX = axis === "x";
  const edgeClass = isX
    ? edge === "end"
      ? "right-0 translate-x-1/2"
      : "left-0 -translate-x-1/2"
    : edge === "end"
      ? "bottom-0 translate-y-1/2"
      : "top-0 -translate-y-1/2";

  return (
    <div
      onMouseDown={onMouseDown}
      className={`absolute z-10 ${edgeClass} ${
        isX ? "top-0 h-full w-1 cursor-col-resize" : "left-0 w-full h-1 cursor-row-resize"
      } hover:bg-accent/50 active:bg-accent/70`}
    />
  );
}
