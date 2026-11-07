/** Deterministic hue (0-359) for a string, so the same author or label name always gets the same color. */
export function hashHue(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 360;
  }
  return hash;
}
