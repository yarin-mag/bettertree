import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Draws a divider above this item. */
  separatorBefore?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const VIEWPORT_MARGIN = 4;

export function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the viewport once its size is known.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN)),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']:not(:disabled)")?.focus();
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (e: Event) => {
      // Scroll targets can be window/document, which are not Nodes `contains` accepts.
      if (!(e.target instanceof Node) || !menuRef.current?.contains(e.target)) onClose();
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", onClose, { capture: true, passive: true });
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") ?? []);
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (current + 1) % buttons.length;
    else if (e.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
      return;
    }
    if (next !== null) {
      e.preventDefault();
      e.stopPropagation();
      buttons[next].focus();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-testid="context-menu"
      className="fixed z-[110] min-w-[10rem] py-1 rounded border border-border-subtle bg-elevated shadow-lg text-xs text-text-primary"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onMenuKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      // The portal is a React child of the clicked row; don't let clicks reach its handlers.
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          {item.separatorBefore && <div className="h-px my-1 bg-border-subtle" role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className="block w-full text-left px-3 py-1 hover:bg-hover focus:bg-hover outline-none disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

/** State helper: `openMenu(e, items)` from an onContextMenu handler; render `menu` once in the component. */
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const close = useCallback(() => setState(null), []);
  const openMenu = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);
  const menu = state ? <ContextMenu x={state.x} y={state.y} items={state.items} onClose={close} /> : null;
  return { openMenu, menu };
}
