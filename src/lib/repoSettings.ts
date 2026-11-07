export interface RepoSettings {
  ticketPattern: string;
  jiraBaseUrl: string;
  worktreeDir: string;
  /** Glob for release tags (e.g. beta-ota-v-mobile-*); empty means any tag. */
  releaseTagPattern: string;
}

export const DEFAULT_REPO_SETTINGS: RepoSettings = {
  ticketPattern: "CEM-\\d+",
  jiraBaseUrl: "https://cemento.atlassian.net/browse/",
  worktreeDir: "",
  releaseTagPattern: "",
};

/** True when the pattern can match an empty string, which would match at every word boundary. */
function matchesEmpty(pattern: string): boolean {
  return new RegExp(`^(?:${pattern})$`).test("");
}

/** Whole-word, global regex for ticket ids; null when empty, invalid, or able to match empty text. */
export function compileTicketPattern(pattern: string): RegExp | null {
  if (!pattern.trim()) return null;
  try {
    if (matchesEmpty(pattern.trim())) return null;
    return new RegExp(`\\b(?:${pattern.trim()})\\b`, "g");
  } catch {
    return null;
  }
}

/** A readable message when `pattern` is unusable as a ticket pattern; null if fine or empty. */
export function ticketPatternError(pattern: string): string | null {
  if (!pattern.trim()) return null;
  try {
    if (matchesEmpty(pattern.trim())) return "Pattern must not match empty text";
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid pattern";
  }
}

export function linkingConfigured(s: RepoSettings): boolean {
  return compileTicketPattern(s.ticketPattern) !== null && s.jiraBaseUrl.trim() !== "";
}
