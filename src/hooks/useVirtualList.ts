import { useCallback, useLayoutEffect, useRef, useState } from "react";

export interface VirtualWindow {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

interface WindowInput {
  count: number;
  itemHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan: number;
  fallbackCount: number;
}

/**
 * Maps a scroll position to the slice [start, end) of rows to render, plus the
 * spacer heights that stand in for the rows left out. Without layout (height 0,
 * e.g. jsdom) it falls back to the first `fallbackCount` rows.
 */
export function computeWindow({
  count,
  itemHeight,
  scrollTop,
  viewportHeight,
  overscan,
  fallbackCount,
}: WindowInput): VirtualWindow {
  let start = 0;
  let end: number;
  if (viewportHeight <= 0) {
    end = Math.min(count, fallbackCount);
  } else {
    start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    end = Math.min(count, Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan);
    start = Math.min(start, end);
  }
  return { start, end, padTop: start * itemHeight, padBottom: (count - end) * itemHeight };
}

interface Options {
  count: number;
  itemHeight: number;
  overscan?: number;
  fallbackCount?: number;
}

/** Fixed-row-height windowing for a scrollable container: attach `ref` and `onScroll` to it. */
export function useVirtualList<T extends HTMLElement = HTMLDivElement>({
  count,
  itemHeight,
  overscan = 8,
  fallbackCount = 60,
}: Options) {
  const ref = useRef<T>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    if (ref.current) setScrollTop(ref.current.scrollTop);
  }, []);

  /** Scrolls the minimum distance that brings row `index` fully into view. */
  const scrollToIndex = useCallback(
    (index: number, align: "nearest" | "center" = "nearest") => {
      const el = ref.current;
      if (!el) return;
      const top = index * itemHeight;
      const height = el.clientHeight;
      let next = el.scrollTop;
      if (align === "center") next = top - (height - itemHeight) / 2;
      else if (top < next) next = top;
      else if (top + itemHeight > next + height) next = top + itemHeight - height;
      next = Math.max(0, next);
      if (next !== el.scrollTop) {
        el.scrollTop = next;
        setScrollTop(next);
      }
    },
    [itemHeight]
  );

  const window = computeWindow({ count, itemHeight, scrollTop, viewportHeight, overscan, fallbackCount });
  return { ref, onScroll, scrollToIndex, ...window };
}
