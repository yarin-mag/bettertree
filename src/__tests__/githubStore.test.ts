import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeGetGithubStatus: vi.fn(),
  invokeListPullRequests: vi.fn(),
  invokeFetchPrRef: vi.fn(),
  invokeGetPullRequest: vi.fn(),
  invokeListGithubBranches: vi.fn(),
  invokeListAssignableUsers: vi.fn(),
  invokeListPrComments: vi.fn(),
  invokeAddPrComment: vi.fn(),
}));

import { useGithubStore } from "../store/githubStore";
import * as tauriLib from "../lib/tauri";

describe("githubStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useGithubStore.setState({
      query: "",
      status: null,
      pullRequests: [],
      isLoadingPrs: false,
      branches: [],
      selectedPrNumber: null,
      prDetail: null,
      prComments: [],
      openingPrNumber: null,
    });
  });

  it("loadBranches populates branches from the backend", async () => {
    (tauriLib.invokeListGithubBranches as any).mockResolvedValue(["main", "develop", "feature/foo"]);

    await useGithubStore.getState().loadBranches("/tmp/a");

    expect(tauriLib.invokeListGithubBranches).toHaveBeenCalledWith("/tmp/a");
    expect(useGithubStore.getState().branches).toEqual(["develop", "feature/foo", "main"]);
  });

  it("loadBranches shows cached branches instantly, then merges in newly fetched ones", async () => {
    (tauriLib.invokeListGithubBranches as any).mockResolvedValue(["main", "develop"]);
    await useGithubStore.getState().loadBranches("/tmp/a");
    expect(useGithubStore.getState().branches).toEqual(["develop", "main"]);

    let resolveFn: (value: any) => void;
    (tauriLib.invokeListGithubBranches as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    const promise = useGithubStore.getState().loadBranches("/tmp/a");
    // cached branches show immediately, without waiting on the in-flight fetch
    expect(useGithubStore.getState().branches).toEqual(["develop", "main"]);
    expect(useGithubStore.getState().isLoadingBranches).toBe(false);

    resolveFn!(["main", "feature/new-thing"]);
    await promise;
    expect(useGithubStore.getState().branches).toEqual(["develop", "feature/new-thing", "main"]);
  });

  it("defaults to an empty query", () => {
    expect(useGithubStore.getState().query).toBe("");
  });

  it("setQualifier upserts a token into the query", () => {
    useGithubStore.getState().setQualifier("author", "yarinmag");
    expect(useGithubStore.getState().query).toBe("author:yarinmag");
  });

  it("loadStatus populates status from the backend", async () => {
    (tauriLib.invokeGetGithubStatus as any).mockResolvedValue({
      available: true,
      owner: "acme",
      repo: "widgets",
      reason: null,
    });

    await useGithubStore.getState().loadStatus("/tmp/a");

    expect(useGithubStore.getState().status).toEqual({
      available: true,
      owner: "acme",
      repo: "widgets",
      reason: null,
    });
  });

  it("searchPullRequests populates pullRequests using the current query", async () => {
    useGithubStore.setState({ query: "is:open" });
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([
      { number: 1, title: "Fix", author: "a", headRefName: "h", baseRefName: "main", state: "OPEN", isDraft: false, labels: [], updatedAt: "now", url: "u" },
    ]);

    await useGithubStore.getState().searchPullRequests("/tmp/a");

    expect(tauriLib.invokeListPullRequests).toHaveBeenCalledWith("/tmp/a", "is:open");
    expect(useGithubStore.getState().pullRequests).toHaveLength(1);
  });

  it("openPullRequest fetches the PR ref, detail, and comments, then shows the PR detail", async () => {
    (tauriLib.invokeFetchPrRef as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetPullRequest as any).mockResolvedValue({
      pullRequest: { number: 42, title: "t", author: "a", headRefName: "h", baseRefName: "main", state: "OPEN", isDraft: false, labels: [], updatedAt: "now", url: "u" },
      commits: [{ oid: "c1", messageHeadline: "first" }],
      body: "hello",
    });
    (tauriLib.invokeListPrComments as any).mockResolvedValue([
      { id: 1, author: "avery", body: "hi", createdAt: "now", url: "u" },
    ]);

    await useGithubStore.getState().openPullRequest("/tmp/a", 42);

    expect(tauriLib.invokeFetchPrRef).toHaveBeenCalledWith("/tmp/a", 42);
    expect(tauriLib.invokeGetPullRequest).toHaveBeenCalledWith("/tmp/a", 42);
    expect(tauriLib.invokeListPrComments).toHaveBeenCalledWith("/tmp/a", 42);
    expect(useGithubStore.getState().selectedPrNumber).toBe(42);
    expect(useGithubStore.getState().prDetail?.body).toBe("hello");
    expect(useGithubStore.getState().prComments).toHaveLength(1);
  });

  it("openPullRequest sets openingPrNumber while in flight, and clears it after", async () => {
    let resolveFn: (value: any) => void;
    (tauriLib.invokeFetchPrRef as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    (tauriLib.invokeGetPullRequest as any).mockResolvedValue({
      pullRequest: { number: 42, title: "t", author: "a", headRefName: "h", baseRefName: "main", state: "OPEN", isDraft: false, labels: [], updatedAt: "now", url: "u" },
      commits: [],
      body: "",
    });
    (tauriLib.invokeListPrComments as any).mockResolvedValue([]);

    const promise = useGithubStore.getState().openPullRequest("/tmp/a", 42);
    expect(useGithubStore.getState().openingPrNumber).toBe(42);
    resolveFn!(undefined);
    await promise;
    expect(useGithubStore.getState().openingPrNumber).toBeNull();
  });

  it("openPullRequest clears openingPrNumber even when it fails", async () => {
    (tauriLib.invokeFetchPrRef as any).mockRejectedValue("network error");

    await expect(useGithubStore.getState().openPullRequest("/tmp/a", 42)).rejects.toBeDefined();

    expect(useGithubStore.getState().openingPrNumber).toBeNull();
  });

  it("closePullRequestDetail clears the selected PR and its data", () => {
    useGithubStore.setState({
      selectedPrNumber: 42,
      prDetail: { pullRequest: {} as any, commits: [], body: "hi" },
      prComments: [{ id: 1, author: "a", body: "b", createdAt: "now", url: "u" }],
    });

    useGithubStore.getState().closePullRequestDetail();

    expect(useGithubStore.getState().selectedPrNumber).toBeNull();
    expect(useGithubStore.getState().prDetail).toBeNull();
    expect(useGithubStore.getState().prComments).toEqual([]);
  });

  it("addComment posts a comment for the selected PR and appends it", async () => {
    useGithubStore.setState({ selectedPrNumber: 42, prComments: [] });
    (tauriLib.invokeAddPrComment as any).mockResolvedValue({
      id: 2,
      author: "yarinmag",
      body: "thanks",
      createdAt: "now",
      url: "u",
    });

    await useGithubStore.getState().addComment("/tmp/a", "thanks");

    expect(tauriLib.invokeAddPrComment).toHaveBeenCalledWith("/tmp/a", 42, "thanks");
    expect(useGithubStore.getState().prComments).toHaveLength(1);
    expect(useGithubStore.getState().prComments[0].body).toBe("thanks");
  });

  it("searchPullRequests sets isLoadingPrs while in flight", async () => {
    let resolveFn: (value: any) => void;
    (tauriLib.invokeListPullRequests as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );

    const promise = useGithubStore.getState().searchPullRequests("/tmp/a");
    expect(useGithubStore.getState().isLoadingPrs).toBe(true);
    resolveFn!([]);
    await promise;
    expect(useGithubStore.getState().isLoadingPrs).toBe(false);
  });

  it("loadAssignableUsers populates assignableUsers from the backend", async () => {
    (tauriLib.invokeListAssignableUsers as any).mockResolvedValue(["alice", "bob"]);

    await useGithubStore.getState().loadAssignableUsers("/tmp/a");

    expect(tauriLib.invokeListAssignableUsers).toHaveBeenCalledWith("/tmp/a");
    expect(useGithubStore.getState().assignableUsers).toEqual(["alice", "bob"]);
  });

  it("loadAssignableUsers shows cached users instantly, then merges in newly fetched ones", async () => {
    (tauriLib.invokeListAssignableUsers as any).mockResolvedValue(["alice"]);
    await useGithubStore.getState().loadAssignableUsers("/tmp/a");
    expect(useGithubStore.getState().assignableUsers).toEqual(["alice"]);

    let resolveFn: (value: any) => void;
    (tauriLib.invokeListAssignableUsers as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    const promise = useGithubStore.getState().loadAssignableUsers("/tmp/a");
    expect(useGithubStore.getState().assignableUsers).toEqual(["alice"]);
    expect(useGithubStore.getState().isLoadingAssignableUsers).toBe(false);

    resolveFn!(["alice", "bob"]);
    await promise;
    expect(useGithubStore.getState().assignableUsers).toEqual(["alice", "bob"]);
  });
});
