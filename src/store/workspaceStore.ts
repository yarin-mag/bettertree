import { create } from "zustand";
import {
  invokeListRepos,
  invokeAddRepo,
  invokeGetBranches,
  invokeGetTags,
  invokeGetCommitGraph,
  invokeEnsureSearchIndex,
  invokeSwitchBranch,
  RepoEntry,
  BranchInfo,
  TagInfo,
  GraphCommit,
} from "../lib/tauri";

interface WorkspaceState {
  repos: RepoEntry[];
  activeRepoId: number | null;
  branches: BranchInfo[];
  tags: TagInfo[];
  commits: GraphCommit[];
  loadRepos: () => Promise<void>;
  addRepo: (path: string) => Promise<void>;
  setActiveRepo: (id: number) => Promise<void>;
  switchBranch: (repoPath: string, branchName: string, isRemote: boolean) => Promise<void>;
  refreshActiveRepoData: (repoPath: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  repos: [],
  activeRepoId: null,
  branches: [],
  tags: [],
  commits: [],

  loadRepos: async () => {
    const repos = await invokeListRepos();
    set({ repos });
  },

  addRepo: async (path: string) => {
    const repo = await invokeAddRepo(path);
    set({ repos: [...get().repos, repo] });
  },

  refreshActiveRepoData: async (repoPath: string) => {
    const [branches, tags, commits] = await Promise.all([
      invokeGetBranches(repoPath),
      invokeGetTags(repoPath),
      invokeGetCommitGraph(repoPath, 200),
    ]);
    set({ branches, tags, commits });
    // Fire-and-forget: index build must not block the UI, and a failed
    // build degrades to the live-walk fallback in search_commits.
    invokeEnsureSearchIndex(repoPath).catch(() => {});
  },

  setActiveRepo: async (id: number) => {
    const repo = get().repos.find((r) => r.id === id);
    if (!repo) return;
    set({ activeRepoId: id });
    await get().refreshActiveRepoData(repo.path);
  },

  switchBranch: async (repoPath: string, branchName: string, isRemote: boolean) => {
    await invokeSwitchBranch(repoPath, branchName, isRemote);
    await get().refreshActiveRepoData(repoPath);
  },
}));
