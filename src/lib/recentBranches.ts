const STORAGE_KEY = "bettertree.recentBranches";
const MAX_ENTRIES = 5;

export function getRecentBranches(): string[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function recordRecentBranch(name: string): void {
  const existing = getRecentBranches().filter((n) => n !== name);
  const updated = [name, ...existing].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
