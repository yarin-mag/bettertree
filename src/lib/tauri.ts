import type { RepoSettings } from "./repoSettings";
import { invoke } from "@tauri-apps/api/core";
import type { ActiveThemeRef, CustomTheme, ThemeColors } from "./themes";

export interface Settings {
  theme: { active: ActiveThemeRef; customThemes: CustomTheme[] };
  fontSize: { ui: number; diffView: number };
  diffViewTheme: Partial<ThemeColors> | null;
}

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

export interface BranchListResult {
  branches: BranchInfo[];
  headDetached: boolean;
  headOid: string | null;
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
  invoke<BranchListResult>("get_branches", { repoPath });
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
  until?: number,
  commitId?: string,
  filePath?: string
) =>
  invoke<SearchHit[]>("search_commits", {
    repoPath,
    query,
    author,
    since,
    until,
    commitId,
    filePath,
  });

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
  // Set by the backend for binary deltas; absent on older payloads.
  isBinary?: boolean;
}

export interface CommitDetail {
  oid: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
  files: FileDiff[];
  parents: string[];
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

export interface ConflictedFile {
  path: string;
  status: string;
}
export interface ConflictState {
  files: ConflictedFile[];
  inProgress: boolean;
  operation: "merge" | "rebase" | null;
}
export const invokeListConflictedFiles = (repoPath: string) =>
  invoke<ConflictState>("list_conflicted_files", { repoPath });
export const invokeOpenInEditor = (repoPath: string, file: string) =>
  invoke<void>("open_in_editor", { repoPath, file });
export const invokeAbortMerge = (repoPath: string) => invoke<void>("abort_merge", { repoPath });
export const invokeMarkResolved = (repoPath: string, file: string) =>
  invoke<void>("mark_resolved", { repoPath, file });

export const invokeSwitchBranch = (repoPath: string, branchName: string, isRemote: boolean) =>
  invoke<void>("switch_branch", { repoPath, branchName, isRemote });

export const invokeCheckoutTag = (repoPath: string, tagName: string) =>
  invoke<void>("checkout_tag", { repoPath, tagName });

export const invokeCreateBranch = (repoPath: string, branchName: string, oid: string) =>
  invoke<void>("create_branch", { repoPath, branchName, oid });

export interface AheadBehind {
  ahead: number;
  behind: number;
  upstream: string;
}

export const invokeGetAheadBehind = (repoPath: string) =>
  invoke<AheadBehind | null>("get_ahead_behind", { repoPath });

export const invokeCherryPickCommit = (repoPath: string, oid: string) =>
  invoke<string>("cherry_pick_commit", { repoPath, oid });

export interface GithubStatus {
  available: boolean;
  owner: string | null;
  repo: string | null;
  reason: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  headRefName: string;
  baseRefName: string;
  state: string;
  isDraft: boolean;
  labels: string[];
  updatedAt: string;
  url: string;
  statusCheckRollup: "success" | "pending" | "failure" | null;
  reviewDecision: string | null;
}

export interface PullRequestCommit {
  oid: string;
  messageHeadline: string;
}

export interface PullRequestDetail {
  pullRequest: PullRequest;
  commits: PullRequestCommit[];
  body: string;
}

export const invokeGetGithubStatus = (repoPath: string) =>
  invoke<GithubStatus>("get_github_status", { repoPath });
export const invokeListPullRequests = (repoPath: string, query: string) =>
  invoke<PullRequest[]>("list_pull_requests", { repoPath, query });
export interface CommitPullRequest {
  number: number;
  title: string;
  url: string;
}
export const invokeListCommitPullRequests = (repoPath: string, oid: string) =>
  invoke<CommitPullRequest[]>("list_commit_pull_requests", { repoPath, oid });

export type CiState = "success" | "pending" | "failure" | "none";
export interface WorkflowCi { workflowId: number; workflowName: string; state: CiState }
export interface CommitCi { oid: string; state: CiState; total: number; failed: number; pending: number; byWorkflow: WorkflowCi[] }
export interface CiStep { number: number; name: string; status: string; conclusion: string | null }
export interface CiJob { jobId: number; name: string; status: string; conclusion: string | null; startedAt: string | null; completedAt: string | null; url: string; steps: CiStep[] }
export interface CiWorkflowRun { runId: number; workflowId: number; workflowName: string; status: string; conclusion: string | null; url: string; startedAt: string | null; updatedAt: string | null; jobs: CiJob[] }
export interface CiOtherCheck { name: string; state: CiState; url: string | null; source: string }
export interface CommitChecks { oid: string; runs: CiWorkflowRun[]; other: CiOtherCheck[] }
export interface JobLog { text: string; truncated: boolean }

export const invokeCiStatusForCommits = (repoPath: string, oids: string[]) =>
  invoke<CommitCi[]>("ci_status_for_commits", { repoPath, oids });
export const invokeCiCommitChecks = (repoPath: string, oid: string) =>
  invoke<CommitChecks>("ci_commit_checks", { repoPath, oid });
export const invokeCiJobLog = (repoPath: string, jobId: number, full: boolean) =>
  invoke<JobLog>("ci_job_log", { repoPath, jobId, full });
export const invokeCiRerun = (repoPath: string, runId: number, failedOnly: boolean) =>
  invoke<void>("ci_rerun", { repoPath, runId, failedOnly });
export const invokeCiCancel = (repoPath: string, runId: number) => invoke<void>("ci_cancel", { repoPath, runId });
export interface RunSummary { runId: number; workflowId: number; workflowName: string; title: string; branch: string | null; sha: string; event: string; actor: string | null; status: string; conclusion: string | null; createdAt: string; startedAt: string | null; updatedAt: string | null; url: string; attempt: number }
export interface RunsPage { runs: RunSummary[]; hasMore: boolean }
export interface WorkflowInfo { id: number; name: string; state: string }
export interface RunFilters { branch?: string; event?: string; status?: string; actor?: string; workflowId?: number; page?: number }
export const invokeCiListRuns = (repoPath: string, filters: RunFilters) => invoke<RunsPage>("ci_list_runs", { repoPath, filters });
export const invokeCiListWorkflows = (repoPath: string) => invoke<WorkflowInfo[]>("ci_list_workflows", { repoPath });
export const invokeCiRunJobs = (repoPath: string, runId: number) => invoke<CiJob[]>("ci_run_jobs", { repoPath, runId });
export const invokeGetPullRequest = (repoPath: string, number: number) =>
  invoke<PullRequestDetail>("get_pull_request", { repoPath, number });

export interface PrComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  url: string;
}

export const invokeListPrComments = (repoPath: string, number: number) =>
  invoke<PrComment[]>("list_pr_comments", { repoPath, number });

export const invokeAddPrComment = (repoPath: string, number: number, body: string) =>
  invoke<PrComment>("add_pr_comment", { repoPath, number, body });
export const invokeFetchPrRef = (repoPath: string, number: number) =>
  invoke<void>("fetch_pr_ref", { repoPath, number });
export const invokeListGithubBranches = (repoPath: string) =>
  invoke<string[]>("list_github_branches", { repoPath });
export const invokeListAssignableUsers = (repoPath: string) =>
  invoke<string[]>("list_assignable_users", { repoPath });

export interface DiffLineInfo {
  kind: "add" | "del" | "context";
  content: string;
  oldLine: number | null;
  newLine: number | null;
}
export interface PrFileDiff {
  path: string;
  status: string;
  lines: DiffLineInfo[];
  insertions: number;
  deletions: number;
}
export interface PrDiff {
  baseOid: string;
  headOid: string;
  files: PrFileDiff[];
}
export interface PrReviewComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  url: string;
}

export const invokeGetPrDiff = (repoPath: string, number: number, baseRefName: string) =>
  invoke<PrDiff>("get_pr_diff", { repoPath, number, baseRefName });
export const invokeListPrReviewComments = (repoPath: string, number: number) =>
  invoke<PrReviewComment[]>("list_pr_review_comments", { repoPath, number });
export const invokeAddPrReviewComment = (
  repoPath: string,
  number: number,
  path: string,
  line: number,
  side: "LEFT" | "RIGHT",
  body: string
) => invoke<PrReviewComment>("add_pr_review_comment", { repoPath, number, path, line, side, body });

export interface CommitSummary {
  oid: string;
  summary: string;
  author: string;
  timestamp: number;
}

export interface CompareResult {
  baseOid: string;
  compareOid: string;
  mergeBaseOid: string | null;
  onlyInBase: CommitSummary[];
  onlyInCompare: CommitSummary[];
  graph: GraphCommit[];
}

export const invokeCompareRefs = (repoPath: string, baseRef: string, compareRef: string) =>
  invoke<CompareResult>("compare_refs", { repoPath, baseRef, compareRef });

export const invokeGetSettings = () => invoke<Settings>("get_settings");
export const invokeWriteSettings = (value: Settings) => invoke<void>("write_settings", { value });

export const invokeReleaseNotesCommits = (repoPath: string, from: string, to: string) =>
  invoke<{ oid: string; subject: string; timestamp: number }[]>("release_notes_commits", {
    repoPath,
    from,
    to,
  });

export const invokeStashChanges = (repoPath: string, message: string) =>
  invoke<void>("stash_changes", { repoPath, message });

export const invokeStashPop = (repoPath: string) => invoke<void>("stash_pop", { repoPath });

export const invokeDiscardChanges = (repoPath: string) => invoke<void>("discard_changes", { repoPath });

export const invokeAddWorktree = (repoPath: string, branchName: string, isRemote: boolean, path: string) =>
  invoke<void>("add_worktree", { repoPath, branchName, isRemote, path });

export const invokeGetRepoSettings = (repoPath: string) =>
  invoke<RepoSettings>("get_repo_settings", { repoPath });

export const invokeSetRepoSettings = (repoPath: string, settings: RepoSettings) =>
  invoke<RepoSettings>("set_repo_settings", { repoPath, settings });

export const invokeResetRepoSettings = (repoPath: string) =>
  invoke<void>("reset_repo_settings", { repoPath });

export interface ReleaseTag {
  name: string;
  oid: string;
  timestamp: number;
}

export interface ReleaseNoteEntry {
  id: number;
  fromLabel: string;
  toLabel: string;
  text: string;
  createdAt: number;
}

export const invokeLatestReleaseTag = (repoPath: string, pattern: string) =>
  invoke<ReleaseTag | null>("latest_release_tag", { repoPath, pattern });

export const invokeAddReleaseNote = (repoPath: string, fromLabel: string, toLabel: string, text: string) =>
  invoke<ReleaseNoteEntry>("add_release_note", { repoPath, fromLabel, toLabel, text });

export const invokeListReleaseNotes = (repoPath: string) =>
  invoke<ReleaseNoteEntry[]>("list_release_notes", { repoPath });

export const invokeDeleteReleaseNote = (id: number) => invoke<void>("delete_release_note", { id });

export interface OpenTarget {
  id: string;
  label: string;
}

export const invokeListOpenTargets = (repoPath: string) =>
  invoke<OpenTarget[]>("list_open_targets", { repoPath });

export const invokeOpenIn = (targetId: string, repoPath: string) =>
  invoke<void>("open_in", { targetId, repoPath });

export interface SearchIndexUsage {
  key: string;
  repoPath: string | null;
  sizeBytes: number;
  lastUsed: number;
}

export const invokeListSearchIndexUsage = () =>
  invoke<SearchIndexUsage[]>("list_search_index_usage");

/** Deletes one index by key, or all of them when no key is given. */
export const invokeClearSearchIndex = (key?: string) =>
  invoke<void>("clear_search_index", { key: key ?? null });
