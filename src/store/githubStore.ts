import { create } from "zustand";
import {
  invokeGetGithubStatus,
  invokeListPullRequests,
  invokeFetchPrRef,
  invokeGetPullRequest,
  invokeListGithubBranches,
  invokeListAssignableUsers,
  invokeListPrComments,
  invokeAddPrComment,
  type GithubStatus,
  type PullRequest,
  type PullRequestDetail,
  type PrComment,
} from "../lib/tauri";
import { setQualifier as upsertQualifier } from "../lib/qualifierQuery";
import { getCachedList, mergeCachedList } from "../lib/githubListCache";

interface GithubState {
  query: string;
  setQuery: (query: string) => void;
  setQualifier: (key: string, value: string | null) => void;

  status: GithubStatus | null;
  loadStatus: (repoPath: string) => Promise<void>;

  pullRequests: PullRequest[];
  isLoadingPrs: boolean;
  searchPullRequests: (repoPath: string) => Promise<void>;

  selectedPrNumber: number | null;
  prDetail: PullRequestDetail | null;
  prComments: PrComment[];
  openingPrNumber: number | null;
  openPullRequest: (repoPath: string, number: number) => Promise<void>;
  closePullRequestDetail: () => void;
  addComment: (repoPath: string, body: string) => Promise<void>;

  branches: string[];
  isLoadingBranches: boolean;
  loadBranches: (repoPath: string) => Promise<void>;

  assignableUsers: string[];
  isLoadingAssignableUsers: boolean;
  loadAssignableUsers: (repoPath: string) => Promise<void>;
}

export const useGithubStore = create<GithubState>((set, get) => ({
  query: "",
  setQuery: (query: string) => set({ query }),
  setQualifier: (key: string, value: string | null) => {
    set({ query: upsertQualifier(get().query, key, value) });
  },

  status: null,
  loadStatus: async (repoPath: string) => {
    const status = await invokeGetGithubStatus(repoPath);
    set({ status });
  },

  pullRequests: [],
  isLoadingPrs: false,
  searchPullRequests: async (repoPath: string) => {
    set({ isLoadingPrs: true });
    try {
      const pullRequests = await invokeListPullRequests(repoPath, get().query);
      set({ pullRequests });
    } finally {
      set({ isLoadingPrs: false });
    }
  },

  selectedPrNumber: null,
  prDetail: null,
  prComments: [],
  openingPrNumber: null,
  openPullRequest: async (repoPath: string, number: number) => {
    set({ openingPrNumber: number });
    try {
      await invokeFetchPrRef(repoPath, number);
      const [detail, comments] = await Promise.all([
        invokeGetPullRequest(repoPath, number),
        invokeListPrComments(repoPath, number),
      ]);
      set({ selectedPrNumber: number, prDetail: detail, prComments: comments });
    } finally {
      set({ openingPrNumber: null });
    }
  },
  closePullRequestDetail: () => set({ selectedPrNumber: null, prDetail: null, prComments: [] }),
  addComment: async (repoPath: string, body: string) => {
    const number = get().selectedPrNumber;
    if (number == null) return;
    const comment = await invokeAddPrComment(repoPath, number, body);
    set({ prComments: [...get().prComments, comment] });
  },

  branches: [],
  isLoadingBranches: false,
  loadBranches: async (repoPath: string) => {
    const cached = getCachedList("branches", repoPath);
    set({ branches: cached, isLoadingBranches: cached.length === 0 });
    try {
      const fresh = await invokeListGithubBranches(repoPath);
      set({ branches: mergeCachedList("branches", repoPath, fresh) });
    } finally {
      set({ isLoadingBranches: false });
    }
  },

  assignableUsers: [],
  isLoadingAssignableUsers: false,
  loadAssignableUsers: async (repoPath: string) => {
    const cached = getCachedList("assignableUsers", repoPath);
    set({ assignableUsers: cached, isLoadingAssignableUsers: cached.length === 0 });
    try {
      const fresh = await invokeListAssignableUsers(repoPath);
      set({ assignableUsers: mergeCachedList("assignableUsers", repoPath, fresh) });
    } finally {
      set({ isLoadingAssignableUsers: false });
    }
  },
}));
