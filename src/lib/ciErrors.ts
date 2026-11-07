export type CiErrorKind = "no-gh" | "unauthenticated" | "rate-limited" | "forbidden" | "other";

export function classifyCiError(message: string): { kind: CiErrorKind; retryAt?: number } {
  const m = message.toLowerCase();
  if (m.includes("failed to run gh") || m.includes("no such file") || m.includes("not installed")) return { kind: "no-gh" };
  if (m.includes("gh auth login") || m.includes("not logged in") || m.includes("authentication") || m.includes("http 401") || m.includes("bad credentials")) return { kind: "unauthenticated" };
  if (m.includes("rate limit")) return { kind: "rate-limited" };
  if (m.includes("http 403") || m.includes("not accessible") || m.includes("forbidden")) return { kind: "forbidden" };
  return { kind: "other" };
}

export function shortCiError(message: string, max = 200): string {
  return message.length <= max ? message : `${message.slice(0, max)}…`;
}
