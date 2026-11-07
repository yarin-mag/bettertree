import { create } from "zustand";

export interface PinnedCommit {
  key: string; // `${repoPath}:${oid}`
  repoPath: string;
  oid: string;
  summary: string;
}

export interface PinnedPr {
  key: string; // `${owner}/${repo}#${number}`
  owner: string;
  repo: string;
  number: number;
  title: string;
}

const COMMITS_KEY = "pinned.commits";
const PRS_KEY = "pinned.prs";

function load<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // best-effort
  }
}

export const commitKey = (repoPath: string, oid: string) => `${repoPath}:${oid}`;
export const prKey = (owner: string, repo: string, number: number) => `${owner}/${repo}#${number}`;

interface PinnedState {
  pinnedCommits: PinnedCommit[];
  pinnedPrs: PinnedPr[];
  toggleCommit: (commit: Omit<PinnedCommit, "key">) => void;
  togglePr: (pr: Omit<PinnedPr, "key">) => void;
  isCommitPinned: (repoPath: string, oid: string) => boolean;
  isPrPinned: (owner: string, repo: string, number: number) => boolean;
}

export const usePinnedStore = create<PinnedState>((set, get) => ({
  pinnedCommits: load<PinnedCommit>(COMMITS_KEY),
  pinnedPrs: load<PinnedPr>(PRS_KEY),

  toggleCommit: (commit) => {
    const key = commitKey(commit.repoPath, commit.oid);
    const exists = get().pinnedCommits.some((c) => c.key === key);
    const pinnedCommits = exists
      ? get().pinnedCommits.filter((c) => c.key !== key)
      : [{ ...commit, key }, ...get().pinnedCommits];
    save(COMMITS_KEY, pinnedCommits);
    set({ pinnedCommits });
  },

  togglePr: (pr) => {
    const key = prKey(pr.owner, pr.repo, pr.number);
    const exists = get().pinnedPrs.some((p) => p.key === key);
    const pinnedPrs = exists
      ? get().pinnedPrs.filter((p) => p.key !== key)
      : [{ ...pr, key }, ...get().pinnedPrs];
    save(PRS_KEY, pinnedPrs);
    set({ pinnedPrs });
  },

  isCommitPinned: (repoPath, oid) => get().pinnedCommits.some((c) => c.key === commitKey(repoPath, oid)),
  isPrPinned: (owner, repo, number) => get().pinnedPrs.some((p) => p.key === prKey(owner, repo, number)),
}));
