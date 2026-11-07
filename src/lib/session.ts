import type { ActiveView } from "../store/viewStore";

export interface Session {
  repoPath: string | null;
  view: ActiveView;
  selectedCommitOid: string | null;
}

const KEY = "bettertree.session";
const VIEWS: ActiveView[] = ["repo", "pulls", "compare", "actions"];

/** The saved session, field by field: anything missing or invalid is left out. */
export function readSession(): Partial<Session> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Session> = {};
    if (typeof parsed.repoPath === "string") out.repoPath = parsed.repoPath;
    if (VIEWS.includes(parsed.view as ActiveView)) out.view = parsed.view as ActiveView;
    if (typeof parsed.selectedCommitOid === "string") out.selectedCommitOid = parsed.selectedCommitOid;
    return out;
  } catch {
    return {};
  }
}

export function writeSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // storage blocked: the session just won't survive a restart
  }
}
