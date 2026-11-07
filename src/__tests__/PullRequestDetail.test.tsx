import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";
import { useGithubStore } from "../store/githubStore";
import { usePrDiffStore } from "../store/prDiffStore";

vi.mock("../lib/tauri", () => ({
  invokeGetGithubStatus: vi.fn(),
  invokeListPullRequests: vi.fn(),
  invokeFetchPrRef: vi.fn(),
  invokeGetPullRequest: vi.fn(),
  invokeListGithubBranches: vi.fn(),
  invokeListAssignableUsers: vi.fn(),
  invokeListPrComments: vi.fn(),
  invokeAddPrComment: vi.fn(),
  invokeGetPrDiff: vi.fn(),
  invokeListPrReviewComments: vi.fn(),
  invokeAddPrReviewComment: vi.fn(),
  invokeCiCommitChecks: vi.fn(),
  invokeCiJobLog: vi.fn(),
  invokeCiRerun: vi.fn(),
  invokeCiCancel: vi.fn(),
  invokeCiStatusForCommits: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

import * as tauriLib from "../lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import PullRequestDetail from "../components/PullRequestDetail";

const samplePr = {
  number: 42,
  title: "Fix the thing",
  author: "yarinmag",
  headRefName: "fix-thing",
  baseRefName: "main",
  state: "OPEN",
  isDraft: false,
  labels: ["bug"],
  updatedAt: "2026-07-10T12:00:00Z",
  url: "https://github.com/acme/widgets/pull/42",
  statusCheckRollup: null,
  reviewDecision: null,
};

describe("PullRequestDetail", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
    });
    useGithubStore.setState({
      selectedPrNumber: 42,
      prDetail: { pullRequest: samplePr, commits: [], body: "**bold** body" },
      prComments: [],
    });
    usePrDiffStore.setState({ diff: null, reviewComments: [], isLoadingDiff: false });
  });

  it("renders the PR body as markdown", () => {
    render(<PullRequestDetail />);
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders raw HTML embedded in the body (e.g. <details>/<table> from PR description bots)", () => {
    useGithubStore.setState({
      prDetail: {
        pullRequest: samplePr,
        commits: [],
        body: "<details><summary>Modified files</summary><table><tr><td>a.ts</td></tr></table></details>",
      },
    });
    render(<PullRequestDetail />);
    expect(screen.getByText("Modified files").tagName).toBe("SUMMARY");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("shows 'No comments yet' when there are no comments", () => {
    render(<PullRequestDetail />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();
  });

  it("renders each comment's author and body", () => {
    useGithubStore.setState({
      prComments: [{ id: 1, author: "avery", body: "Looks good", createdAt: "2026-07-20T10:00:00Z", url: "u" }],
    });
    render(<PullRequestDetail />);
    expect(screen.getByText("avery")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
  });

  it("posts a comment and appends it to the list", async () => {
    (tauriLib.invokeAddPrComment as any).mockResolvedValue({
      id: 2,
      author: "yarinmag",
      body: "Thanks!",
      createdAt: "now",
      url: "u",
    });
    render(<PullRequestDetail />);

    fireEvent.change(screen.getByPlaceholderText("Leave a comment"), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(tauriLib.invokeAddPrComment).toHaveBeenCalledWith("/tmp/a", 42, "Thanks!");
    });
    await waitFor(() => {
      expect(screen.getByText("Thanks!")).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Leave a comment")).toHaveValue("");
  });

  it("keeps the draft text and toasts an error when posting fails", async () => {
    (tauriLib.invokeAddPrComment as any).mockRejectedValue("network error");
    render(<PullRequestDetail />);

    fireEvent.change(screen.getByPlaceholderText("Leave a comment"), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((t) => t.kind === "error" && t.message.includes("network error"))).toBe(true);
    });
    expect(screen.getByPlaceholderText("Leave a comment")).toHaveValue("Thanks!");
  });

  it("shows the PR's commits with a count, and a GitHub link when github status is available", async () => {
    useGithubStore.setState({
      status: { available: true, owner: "acme", repo: "widgets", reason: null },
      prDetail: {
        pullRequest: samplePr,
        commits: [
          { oid: "abc1234567", messageHeadline: "fix the thing" },
          { oid: "def4567890", messageHeadline: "add a test" },
        ],
        body: "",
      },
    });
    render(<PullRequestDetail />);
    fireEvent.click(screen.getByText("Commits (2)"));

    expect(screen.getByText("fix the thing")).toBeInTheDocument();
    expect(screen.getByText("add a test")).toBeInTheDocument();
    fireEvent.click(screen.getByText("abc1234"));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/widgets/commit/abc1234567");
  });

  it("shows commit SHAs as plain text (no link) when github status is unavailable", async () => {
    useGithubStore.setState({
      status: null,
      prDetail: {
        pullRequest: samplePr,
        commits: [{ oid: "abc1234567", messageHeadline: "fix the thing" }],
        body: "",
      },
    });
    render(<PullRequestDetail />);
    fireEvent.click(screen.getByText("Commits (1)"));

    expect(screen.getByText("abc1234").tagName).toBe("SPAN");
  });

  it("calls closePullRequestDetail when the back button is clicked", () => {
    render(<PullRequestDetail />);
    fireEvent.click(screen.getByRole("button", { name: /Back to Pull Requests/ }));
    expect(useGithubStore.getState().selectedPrNumber).toBeNull();
  });

  it("loads and shows the diff when switching to Files changed, without refetching on switching back", async () => {
    (tauriLib.invokeGetPrDiff as any).mockResolvedValue({ baseOid: "b", headOid: "h", files: [] });
    (tauriLib.invokeListPrReviewComments as any).mockResolvedValue([]);
    render(<PullRequestDetail />);

    fireEvent.click(screen.getByRole("button", { name: "Files changed" }));

    await waitFor(() => {
      expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledWith("/tmp/a", 42, "main");
    });
    expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Files changed" }));

    await waitFor(() => {
      expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledTimes(1);
    });
  });

  it("Refresh re-fetches the PR and shows a comment added on GitHub since it was opened", async () => {
    (tauriLib.invokeFetchPrRef as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetPullRequest as any).mockResolvedValue({
      pullRequest: samplePr,
      commits: [],
      body: "**bold** body",
    });
    (tauriLib.invokeListPrComments as any).mockResolvedValue([
      { id: 9, author: "someone-else", body: "commented on github.com", createdAt: "now", url: "u" },
    ]);

    render(<PullRequestDetail />);
    expect(screen.getByText("No comments yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(tauriLib.invokeListPrComments).toHaveBeenCalledWith("/tmp/a", 42);
    });
    await waitFor(() => {
      expect(screen.getByText("commented on github.com")).toBeInTheDocument();
    });
  });

  it("also refreshes the diff and review comments when Files changed has already been loaded", async () => {
    (tauriLib.invokeFetchPrRef as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetPullRequest as any).mockResolvedValue({ pullRequest: samplePr, commits: [], body: "" });
    (tauriLib.invokeListPrComments as any).mockResolvedValue([]);
    (tauriLib.invokeGetPrDiff as any).mockResolvedValue({ baseOid: "b", headOid: "h", files: [] });
    (tauriLib.invokeListPrReviewComments as any).mockResolvedValue([]);

    render(<PullRequestDetail />);
    fireEvent.click(screen.getByRole("button", { name: "Files changed" }));
    await waitFor(() => {
      expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(tauriLib.invokeGetPrDiff).toHaveBeenCalledTimes(2);
    });
  });

  it("opens the log viewer when a job in the Checks tab is clicked", async () => {
    useGithubStore.setState({
      status: { available: true, owner: "acme", repo: "widgets", reason: null },
      prDetail: { pullRequest: samplePr, commits: [{ oid: "abc1234567", messageHeadline: "fix" }], body: "" },
    });
    (tauriLib.invokeCiCommitChecks as any).mockResolvedValue({
      oid: "abc1234567",
      other: [],
      runs: [
        {
          runId: 1, workflowId: 1, workflowName: "CI", status: "completed", conclusion: "failure", url: "u", startedAt: null, updatedAt: null,
          jobs: [{ jobId: 7, name: "unit", status: "completed", conclusion: "failure", startedAt: null, completedAt: null, url: "", steps: [] }],
        },
      ],
    });
    (tauriLib.invokeCiJobLog as any).mockResolvedValue({ text: "unit\tSetup\t2026-09-30T10:00:00Z hello log\n", truncated: false });
    render(<PullRequestDetail />);
    fireEvent.click(screen.getByRole("button", { name: "Checks" }));
    fireEvent.click(await screen.findByText("unit"));
    expect(await screen.findByRole("dialog", { name: "Job log" })).toBeInTheDocument();
    await waitFor(() => expect(tauriLib.invokeCiJobLog).toHaveBeenCalledWith("/tmp/a", 7, false));
    expect(await screen.findByText("hello log")).toBeInTheDocument();
  });
});
