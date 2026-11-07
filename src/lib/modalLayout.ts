export interface Size {
  w: number;
  h: number;
}

export const MODAL_MIN: Size = { w: 480, h: 320 };
/** Space kept free around a non-fullscreen modal. */
export const MODAL_MARGIN = 24;
const DEFAULT_MAX_WIDTH = 1152;

/** The largest a windowed modal may be in this viewport. */
export function maxModalSize(viewport: Size): Size {
  return {
    w: Math.max(MODAL_MIN.w, viewport.w - 2 * MODAL_MARGIN),
    h: Math.max(MODAL_MIN.h, viewport.h - 2 * MODAL_MARGIN),
  };
}

export function defaultModalSize(viewport: Size): Size {
  const max = maxModalSize(viewport);
  return { w: Math.min(DEFAULT_MAX_WIDTH, max.w), h: max.h };
}

export function clampModalSize(size: Size, viewport: Size): Size {
  const max = maxModalSize(viewport);
  return {
    w: Math.round(Math.min(max.w, Math.max(MODAL_MIN.w, size.w))),
    h: Math.round(Math.min(max.h, Math.max(MODAL_MIN.h, size.h))),
  };
}
