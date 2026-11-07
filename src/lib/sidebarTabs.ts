// Below this sidebar width the tab row drops its labels and shows icons only.
export const TABS_COMPACT_BELOW = 330;

export function isCompactTabs(width: number): boolean {
  return width < TABS_COMPACT_BELOW;
}
