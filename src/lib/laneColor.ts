const PALETTE = ["#4ea1f0", "#c785f0", "#4ad999", "#f0625f", "#e8d347"];

export function laneColor(lane: number): string {
  if (lane === 0) return "var(--accent)";
  return PALETTE[(lane - 1) % PALETTE.length];
}
