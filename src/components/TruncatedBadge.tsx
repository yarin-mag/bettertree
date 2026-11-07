import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  name: string;
  className: string;
  onClick?: () => void;
  maxWidthClass?: string;
  icon?: ReactNode;
  testId?: string;
}

// The badge often sits inside an overflow-hidden row, so the full-name tooltip
// is portaled to <body> and positioned from the badge's bounding rect, and is
// shown only when the text is actually truncated. Native `title` tooltips are
// unreliable in the desktop webview.
export default function TruncatedBadge({ name, className, onClick, maxWidthClass = "max-w-[8rem]", icon, testId }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const rect = el.getBoundingClientRect();
    setTip({ x: rect.left, y: rect.bottom + 4 });
  };
  return (
    <>
      <span
        ref={ref}
        data-testid={testId}
        className={`px-1 rounded text-[10px] font-mono truncate ${maxWidthClass} ${className} ${onClick ? "cursor-pointer hover:brightness-110" : ""}`}
        onClick={
          onClick &&
          ((e) => {
            e.stopPropagation();
            onClick();
          })
        }
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
      >
        {icon}
        {name}
      </span>
      {tip &&
        createPortal(
          <div
            role="tooltip"
            className="fixed z-[100] max-w-md break-all px-2 py-1 rounded border border-border-subtle bg-elevated text-text-primary text-xs font-mono shadow-lg pointer-events-none"
            style={{ left: tip.x, top: tip.y }}
          >
            {name}
          </div>,
          document.body
        )}
    </>
  );
}
