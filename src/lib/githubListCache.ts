const PREFIX = "bettertree.githubListCache";

function cacheKey(kind: string, repoPath: string): string {
  return `${PREFIX}.${kind}:${repoPath}`;
}

/** Reads a previously cached string list (e.g. branch names, assignable user
 * logins) for a given repo, so the UI can render instantly instead of
 * waiting on a fresh `gh api` round-trip every time. */
export function getCachedList(kind: string, repoPath: string): string[] {
  const raw = localStorage.getItem(cacheKey(kind, repoPath));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : [];
  } catch {
    return [];
  }
}

/** Unions `fresh` into whatever's already cached for this repo/kind (never
 * drops previously-seen entries), persists the result, and returns it. */
export function mergeCachedList(kind: string, repoPath: string, fresh: string[]): string[] {
  const merged = Array.from(new Set([...getCachedList(kind, repoPath), ...fresh])).sort();
  localStorage.setItem(cacheKey(kind, repoPath), JSON.stringify(merged));
  return merged;
}
