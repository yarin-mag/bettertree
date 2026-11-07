import { create } from "zustand";
import {
  invokeListRepos,
  invokeAddRepo,
  invokeRemoveRepo,
  invokeGetBranches,
  invokeGetTags,
  invokeGetCommitGraph,
  invokeEnsureSearchIndex,
  invokeSwitchBranch,
  invokeCheckoutTag,
  invokeGetGithubStatus,
  RepoEntry,
  BranchInfo,
  TagInfo,
  GraphCommit,
} from "../lib/tauri";
import { useGithubStore } from "./githubStore";
import { useRecentReposStore } from "./recentReposStore";

const COMMIT_GRAPH_PAGE_SIZE = 200;

interface WorkspaceState {
  repos: RepoEntry[];
  activeRepoId: number | null;
  branches: BranchInfo[];
  headDetached: boolean;
  headOid: string | null;
  tags: TagInfo[];
  commits: GraphCommit[];
  commitGraphLimit: number;
  hasMoreCommits: boolean;
  isLoadingMoreCommits: boolean;
  loadRepos: () => Promise<void>;
  addRepo: (path: string) => Promise<RepoEntry>;
  removeRepo: (id: number) => Promise<void>;
  setActiveRepo: (id: number) => Promise<void>;
  switchBranch: (repoPath: string, branchName: string, isRemote: boolean) => Promise<void>;
  checkoutTag: (repoPath: string, tagName: string) => Promise<void>;
  refreshActiveRepoData: (repoPath: string) => Promise<void>;
  /**
   * Cheap local re-read of the branch list; reloads the branches, tags and
   * graph only when HEAD or any branch moved. Resolves true when it reloaded.
   * Never touches the network, so it can run on every window focus.
   */
  syncActiveRepo: (repoPath: string) => Promise<boolean>;
  loadMoreCommits: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  repos: [],
  activeRepoId: null,
  branches: [],
  headDetached: false,
  headOid: null,
  tags: [],
  commits: [],
  commitGraphLimit: COMMIT_GRAPH_PAGE_SIZE,
  hasMoreCommits: true,
  isLoadingMoreCommits: false,

  loadRepos: async () => {
    const repos = await invokeListRepos();
    set({ repos });
  },

  addRepo: async (path: string) => {
    const repo = await invokeAddRepo(path);
    set({ repos: [...get().repos, repo] });
    return repo;
  },

  removeRepo: async (id: number) => {
    const repo = get().repos.find((r) => r.id === id);
    if (!repo) return;
    await invokeRemoveRepo(id);
    useRecentReposStore.getState().addClosed({ path: repo.path, name: repo.name });
    const wasActive = get().activeRepoId === id;
    set({
      repos: get().repos.filter((r) => r.id !== id),
      ...(wasActive
        ? {
            activeRepoId: null,
            branches: [],
            headDetached: false,
            headOid: null,
            tags: [],
            commits: [],
            commitGraphLimit: COMMIT_GRAPH_PAGE_SIZE,
            hasMoreCommits: true,
          }
        : {}),
    });
  },

  refreshActiveRepoData: async (repoPath: string) => {
    const [branchResult, tags, commits] = await Promise.all([
      invokeGetBranches(repoPath),
      invokeGetTags(repoPath),
      invokeGetCommitGraph(repoPath, COMMIT_GRAPH_PAGE_SIZE),
    ]);
    set({
      branches: branchResult.branches,
      headDetached: branchResult.headDetached,
      headOid: branchResult.headOid,
      tags,
      commits,
      commitGraphLimit: COMMIT_GRAPH_PAGE_SIZE,
      hasMoreCommits: commits.length === COMMIT_GRAPH_PAGE_SIZE,
    });
    // Fire-and-forget: index build must not block the UI, and a failed
    // build degrades to the live-walk fallback in search_commits.
    invokeEnsureSearchIndex(repoPath).catch(() => {});
    invokeGetGithubStatus(repoPath).then((status) => {
      useGithubStore.setState({ status });
    });
  },

  syncActiveRepo: async (repoPath: string) => {
    const isActive = () => {
      const { repos, activeRepoId } = get();
      return repos.find((r) => r.id === activeRepoId)?.path === repoPath;
    };
    if (!isActive()) return false;
    const fresh = await invokeGetBranches(repoPath);
    // The user may have switched repos while this was in flight.
    if (!isActive()) return false;
    const s = get();
    const same =
      JSON.stringify(fresh.branches) === JSON.stringify(s.branches) &&
      fresh.headOid === s.headOid &&
      fresh.headDetached === s.headDetached;
    if (same) return false;
    await get().refreshActiveRepoData(repoPath);
    return true;
  },

  loadMoreCommits: async () => {
    const { activeRepoId, repos, commitGraphLimit, isLoadingMoreCommits } = get();
    if (isLoadingMoreCommits) return;
    const repo = repos.find((r) => r.id === activeRepoId);
    if (!repo) return;
    const nextLimit = commitGraphLimit + COMMIT_GRAPH_PAGE_SIZE;
    set({ isLoadingMoreCommits: true });
    try {
      const commits = await invokeGetCommitGraph(repo.path, nextLimit);
      set({ commits, commitGraphLimit: nextLimit, hasMoreCommits: commits.length === nextLimit });
    } finally {
      set({ isLoadingMoreCommits: false });
    }
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

  checkoutTag: async (repoPath: string, tagName: string) => {
    await invokeCheckoutTag(repoPath, tagName);
    await get().refreshActiveRepoData(repoPath);
  },
}));
