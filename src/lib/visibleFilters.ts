const STORAGE_KEY = "bettertree.visibleFilters";

export const DEFAULT_VISIBLE_FILTERS: string[] = ["created", "updated", "base", "head", "state", "sort"];

export function getVisibleFilters(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [...DEFAULT_VISIBLE_FILTERS];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string")
      ? parsed
      : [...DEFAULT_VISIBLE_FILTERS];
  } catch {
    return [...DEFAULT_VISIBLE_FILTERS];
  }
}

export function setVisibleFilters(keys: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}
