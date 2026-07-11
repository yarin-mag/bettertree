import { invoke } from "@tauri-apps/api/core";

export interface RepoEntry {
  id: number;
  path: string;
  name: string;
  pinned: boolean;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  targetOid: string;
}

export interface TagInfo {
  name: string;
  targetOid: string;
}

export interface GraphEdge {
  parentOid: string;
  parentLane: number;
}

export interface GraphCommit {
  oid: string;
  summary: string;
  author: string;
  timestamp: number;
  lane: number;
  edges: GraphEdge[];
  activeLanes: boolean[];
}

export const invokeListRepos = () => invoke<RepoEntry[]>("list_repos");
export const invokeAddRepo = (path: string) => invoke<RepoEntry>("add_repo", { path });
export const invokeRemoveRepo = (id: number) => invoke<void>("remove_repo", { id });
export const invokeGetBranches = (repoPath: string) =>
  invoke<BranchInfo[]>("get_branches", { repoPath });
export const invokeGetTags = (repoPath: string) => invoke<TagInfo[]>("get_tags", { repoPath });
export const invokeGetCommitGraph = (repoPath: string, limit: number) =>
  invoke<GraphCommit[]>("get_commit_graph", { repoPath, limit });

export interface SearchHit {
  oid: string;
  summary: string;
  author: string;
  timestamp: number;
  snippet: string;
}

export const invokeEnsureSearchIndex = (repoPath: string) =>
  invoke<void>("ensure_search_index", { repoPath });

export const invokeSearchCommits = (
  repoPath: string,
  query: string,
  author?: string,
  since?: number,
  until?: number
) => invoke<SearchHit[]>("search_commits", { repoPath, query, author, since, until });

export type FileState = "Untracked" | "ModifiedUnstaged" | "ModifiedStaged" | "Deleted" | "Renamed";

export interface StatusEntry {
  path: string;
  state: FileState;
}

export interface FileDiff {
  path: string;
  status: string;
  patch: string;
  oldContent: string | null;
  newContent: string | null;
  insertions: number;
  deletions: number;
}

export interface CommitDetail {
  oid: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
  files: FileDiff[];
}

export const invokeGetStatus = (repoPath: string) => invoke<StatusEntry[]>("get_status", { repoPath });
export const invokeGetWorkingDiff = (repoPath: string, filePath: string, staged: boolean) =>
  invoke<FileDiff>("get_working_diff", { repoPath, filePath, staged });
export const invokeStageFile = (repoPath: string, filePath: string) =>
  invoke<void>("stage_file", { repoPath, filePath });
export const invokeUnstageFile = (repoPath: string, filePath: string) =>
  invoke<void>("unstage_file", { repoPath, filePath });
export const invokeCommitChanges = (repoPath: string, message: string) =>
  invoke<string>("commit_changes", { repoPath, message });
export const invokeGetCommitDiff = (repoPath: string, oid: string) =>
  invoke<CommitDetail>("get_commit_diff", { repoPath, oid });
export const invokeFetchRemote = (repoPath: string) => invoke<void>("fetch_remote", { repoPath });
export const invokePullRemote = (repoPath: string) => invoke<void>("pull_remote", { repoPath });
export const invokePushRemote = (repoPath: string) => invoke<void>("push_remote", { repoPath });

export const invokeSwitchBranch = (repoPath: string, branchName: string, isRemote: boolean) =>
  invoke<void>("switch_branch", { repoPath, branchName, isRemote });
