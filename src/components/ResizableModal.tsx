import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, RotateCcw, X } from "lucide-react";
import { useModalLayoutStore } from "../store/modalLayoutStore";
import { clampModalSize, defaultModalSize, type Size } from "../lib/modalLayout";

type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const HANDLES: { dir: Dir; className: string }[] = [
  { dir: "n", className: "top-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { dir: "s", className: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { dir: "e", className: "right-0 top-3 bottom-3 w-1.5 cursor-ew-resize" },
  { dir: "w", className: "left-0 top-3 bottom-3 w-1.5 cursor-ew-resize" },
  { dir: "ne", className: "top-0 right-0 w-3 h-3 cursor-nesw-resize" },
  { dir: "nw", className: "top-0 left-0 w-3 h-3 cursor-nwse-resize" },
  { dir: "se", className: "bottom-0 right-0 w-3 h-3 cursor-nwse-resize" },
  { dir: "sw", className: "bottom-0 left-0 w-3 h-3 cursor-nesw-resize" },
];

const viewportNow = (): Size => ({ w: window.innerWidth, h: window.innerHeight });

const controlButton = "text-text-muted hover:text-text-primary press-scale";

interface Props {
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  header: ReactNode;
  children: ReactNode;
}

// A centered modal the user can drag larger or smaller from any edge, expand
// to fill the window, and that remembers how they left it.
export default function ResizableModal({ onClose, label, header, children }: Props) {
  const size = useModalLayoutStore((s) => s.size);
  const fullscreen = useModalLayoutStore((s) => s.fullscreen);
  const [viewport, setViewport] = useState<Size>(viewportNow);
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const onResize = () => setViewport(viewportNow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const shown = clampModalSize(size ?? defaultModalSize(viewport), viewport);

  // The modal stays centered, so each edge moves both sides: size changes by twice the pointer travel.
  const startResize = (dir: Dir) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, w: shown.w, h: shown.h };
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      let w = start.w;
      let h = start.h;
      if (dir.includes("e")) w = start.w + 2 * dx;
      if (dir.includes("w")) w = start.w - 2 * dx;
      if (dir.includes("s")) h = start.h + 2 * dy;
      if (dir.includes("n")) h = start.h - 2 * dy;
      useModalLayoutStore.getState().setSize(clampModalSize({ w, h }, viewportNow()));
    };
    const onUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const toggleFullscreen = () => useModalLayoutStore.getState().toggleFullscreen();

  return (
    <div
      data-testid="modal-backdrop"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in ${fullscreen ? "" : "backdrop-blur-sm"}`}
      // Close only when the press started on the backdrop too: ending a drag
      // or text selection outside the panel also fires a click here.
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label={label}
        data-fullscreen={fullscreen}
        style={fullscreen ? { width: "100vw", height: "100vh" } : { width: shown.w, height: shown.h }}
        className={`relative bg-surface border border-border-subtle shadow-2xl p-4 flex flex-col gap-2 overflow-hidden animate-pop-in ${fullscreen ? "rounded-none" : "rounded-lg"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex justify-between items-start gap-2"
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
            toggleFullscreen();
          }}
        >
          <div className="min-w-0 flex-1">{header}</div>
          <div className="flex items-center gap-2 shrink-0">
            {!fullscreen && size !== null && (
              <button
                className={controlButton}
                onClick={() => useModalLayoutStore.getState().resetSize()}
                aria-label="Reset size"
                title="Reset to the default size"
              >
                <RotateCcw size={14} />
              </button>
            )}
            <button
              className={controlButton}
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              title={fullscreen ? "Exit full screen" : "Full screen (or double-click the header)"}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button className={controlButton} onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
        </div>
        {children}
        {!fullscreen &&
          HANDLES.map(({ dir, className }) => (
            <div
              key={dir}
              data-testid={`resize-${dir}`}
              aria-hidden
              onMouseDown={startResize(dir)}
              className={`absolute z-10 hover:bg-accent/40 active:bg-accent/60 ${className}`}
            />
          ))}
      </div>
    </div>
  );
}
