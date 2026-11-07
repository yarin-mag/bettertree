import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";
import { useGithubStore } from "../store/githubStore";
import { usePinnedStore } from "../store/pinnedStore";
import PullRequestsScreen from "../components/PullRequestsScreen";

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

import * as tauriLib from "../lib/tauri";

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
};

describe("PullRequestsScreen", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.clearAllMocks();
    localStorage.clear();
    usePinnedStore.setState({ pinnedCommits: [], pinnedPrs: [] });
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "abc" },
        { name: "develop", isRemote: false, isHead: false, targetOid: "def" },
      ],
    });
    useGithubStore.setState({
      query: "",
      status: { available: true, owner: "acme", repo: "widgets", reason: null },
      pullRequests: [],
      isLoadingPrs: false,
      branches: [],
      selectedPrNumber: null,
      prDetail: null,
      prComments: [],
      openingPrNumber: null,
    });
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([]);
    (tauriLib.invokeListGithubBranches as any).mockResolvedValue(["main", "develop", "feature/foo"]);
    (tauriLib.invokeListAssignableUsers as any).mockResolvedValue(["yarinmag", "octocat"]);
  });

  it("fetches all GitHub branches on mount and offers them in the branch combobox", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(tauriLib.invokeListGithubBranches).toHaveBeenCalledWith("/tmp/a");
    });
    await waitFor(() => {
      expect(useGithubStore.getState().branches).toContain("feature/foo");
    });
    fireEvent.click(screen.getByLabelText("Base branch"));
    expect(screen.getByText("feature/foo")).toBeInTheDocument();
  });

  it("renders each pull request row", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([samplePr]);
    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    });
    expect(screen.getByTestId("pr-row-detail")).toHaveTextContent("#42 by yarinmag");
    expect(screen.getByTestId("pr-row-detail")).toHaveTextContent("main ← fix-thing");
  });

  it("shows CI check and review-decision badges when present", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([
      { ...samplePr, statusCheckRollup: "failure", reviewDecision: "CHANGES_REQUESTED" },
    ]);
    render(<PullRequestsScreen />);
    await waitFor(() => expect(screen.getByText("Fix the thing")).toBeInTheDocument());

    expect(screen.getByTestId("pr-check-badge")).toHaveTextContent("Checks failing");
    expect(screen.getByTestId("pr-review-badge")).toHaveTextContent("Changes requested");
  });

  it("omits check/review badges when the PR has no checks or reviews", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([
      { ...samplePr, statusCheckRollup: null, reviewDecision: null },
    ]);
    render(<PullRequestsScreen />);
    await waitFor(() => expect(screen.getByText("Fix the thing")).toBeInTheDocument());

    expect(screen.queryByTestId("pr-check-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pr-review-badge")).not.toBeInTheDocument();
  });

  it("clicking the pin star toggles the PR in pinnedStore without opening it", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([samplePr]);
    render(<PullRequestsScreen />);
    await waitFor(() => expect(screen.getByText("Fix the thing")).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("Pin PR"));
    expect(usePinnedStore.getState().isPrPinned("acme", "widgets", 42)).toBe(true);
    expect(tauriLib.invokeFetchPrRef).not.toHaveBeenCalled();
  });

  it("clicking a PR row opens its detail view", async () => {
    (tauriLib.invokeFetchPrRef as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetPullRequest as any).mockResolvedValue({
      pullRequest: samplePr,
      commits: [{ oid: "c1", messageHeadline: "fix" }],
      body: "",
    });
    (tauriLib.invokeListPrComments as any).mockResolvedValue([]);
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([samplePr]);

    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Fix the thing"));

    await waitFor(() => {
      expect(tauriLib.invokeFetchPrRef).toHaveBeenCalledWith("/tmp/a", 42);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back to Pull Requests/ })).toBeInTheDocument();
    });
  });

  it("shows a loading spinner on the clicked row and ignores a second click while opening", async () => {
    let resolveFetchRef: (value: any) => void;
    (tauriLib.invokeFetchPrRef as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFetchRef = resolve;
      })
    );
    (tauriLib.invokeGetPullRequest as any).mockResolvedValue({
      pullRequest: samplePr,
      commits: [],
      body: "",
    });
    (tauriLib.invokeListPrComments as any).mockResolvedValue([]);
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([samplePr]);

    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Fix the thing"));
    expect(screen.getByText("Opening…")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Fix the thing"));
    expect(tauriLib.invokeFetchPrRef).toHaveBeenCalledTimes(1);

    resolveFetchRef!(undefined);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Back to Pull Requests/ })).toBeInTheDocument();
    });
  });

  it("selecting an author updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Author"));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ })); // close the menu
    fireEvent.click(screen.getByLabelText("Author"));
    fireEvent.click(screen.getByText("yarinmag"));
    expect(useGithubStore.getState().query).toBe("author:yarinmag");
  });

  it("selecting an assignee updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Assignee"));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Assignee"));
    fireEvent.click(screen.getByText("octocat"));
    expect(useGithubStore.getState().query).toBe("assignee:octocat");
  });

  it("selecting a reviewer updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Reviewer"));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Reviewer"));
    fireEvent.click(screen.getByText("yarinmag"));
    expect(useGithubStore.getState().query).toBe("review-requested:yarinmag");
  });

  it("fetches assignable users on mount", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(tauriLib.invokeListAssignableUsers).toHaveBeenCalledWith("/tmp/a");
    });
  });

  it("shows only the default filters by default", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText("Author")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Label")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Assignee")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Reviewer")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Project")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Milestone")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Created")).toBeInTheDocument();
    expect(screen.getByLabelText("Updated")).toBeInTheDocument();
    expect(screen.getByLabelText("Base branch")).toBeInTheDocument();
    expect(screen.getByLabelText("Head branch")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "State" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sort")).toBeInTheDocument();
  });

  it("removing the Sort filter clears its qualifier and hides the field", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "created-desc" } });
    expect(useGithubStore.getState().query).toBe("sort:created-desc");
    fireEvent.click(screen.getByRole("button", { name: "Remove Sort filter" }));
    expect(useGithubStore.getState().query).toBe("");
    expect(screen.queryByLabelText("Sort")).not.toBeInTheDocument();
  });

  it("removing the State filter resets it to Open (clears is:/state: qualifiers)", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(useGithubStore.getState().query).toBe("is:closed");
    fireEvent.click(screen.getByRole("button", { name: "Remove State filter" }));
    expect(useGithubStore.getState().query).toBe("");
    expect(screen.queryByRole("group", { name: "State" })).not.toBeInTheDocument();
  });

  it("adding Author via the Filters menu shows it", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    expect(screen.queryByLabelText("Author")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    fireEvent.click(screen.getByLabelText("Author"));
    fireEvent.click(screen.getByRole("button", { name: /Filters/ })); // close the menu
    expect(screen.getByLabelText("Author")).toBeInTheDocument();
  });

  it("selecting a base branch updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Base branch"));
    fireEvent.click(screen.getByText("develop"));
    expect(useGithubStore.getState().query).toBe("base:develop");
  });

  it("selecting a head branch updates the qualifier query", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Head branch"));
    fireEvent.click(screen.getByText("develop"));
    expect(useGithubStore.getState().query).toBe("head:develop");
  });

  it("selecting the Today preset under Created sets the created qualifier", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Created"));
    fireEvent.click(screen.getByText("Today"));
    expect(useGithubStore.getState().query).toBe("created:2026-07-21..2026-07-21");
    vi.useRealTimers();
  });

  it("selecting the Today preset under Updated sets the updated qualifier", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("Updated"));
    fireEvent.click(screen.getByText("Today"));
    expect(useGithubStore.getState().query).toBe("updated:2026-07-21..2026-07-21");
    vi.useRealTimers();
  });

  it("defaults the State segmented control to Open", () => {
    render(<PullRequestsScreen />);
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
  });

  it("selecting Closed sets an is:closed qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(useGithubStore.getState().query).toBe("is:closed");
  });

  it("selecting Draft sets an is:draft qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Draft" }));
    expect(useGithubStore.getState().query).toBe("is:draft");
  });

  it("selecting Merged sets an is:merged qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Merged" }));
    expect(useGithubStore.getState().query).toBe("is:merged");
  });

  it("selecting Any sets a state:all qualifier and clears any is: qualifier", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    const stateGroup = screen.getByRole("group", { name: "State" });
    fireEvent.click(within(stateGroup).getByRole("button", { name: "Closed" }));
    fireEvent.click(within(stateGroup).getByRole("button", { name: "Any" }));
    expect(useGithubStore.getState().query).toBe("state:all");
  });

  it("switching back to Open clears the state qualifiers", async () => {
    render(<PullRequestsScreen />);
    await waitFor(() => expect(tauriLib.invokeListPullRequests).toHaveBeenCalled());
    const stateGroup = screen.getByRole("group", { name: "State" });
    fireEvent.click(within(stateGroup).getByRole("button", { name: "Any" }));
    fireEvent.click(within(stateGroup).getByRole("button", { name: "Open" }));
    expect(useGithubStore.getState().query).toBe("");
  });

  it("automatically loads pull requests on mount without needing to click Search", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([samplePr]);

    render(<PullRequestsScreen />);

    await waitFor(() => {
      expect(tauriLib.invokeListPullRequests).toHaveBeenCalledWith("/tmp/a", "");
    });
  });

  it("clicking Search calls searchPullRequests with the active repo", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([]);
    render(<PullRequestsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(tauriLib.invokeListPullRequests).toHaveBeenCalledWith("/tmp/a", "");
    });
  });

  it("toasts an error and stays on the PR list when opening a PR fails", async () => {
    (tauriLib.invokeFetchPrRef as any).mockRejectedValue("network error: could not fetch pull/42/head");
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([samplePr]);

    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Fix the thing"));

    await waitFor(() => {
      expect(
        useToastStore.getState().toasts.some((t) => t.kind === "error" && t.message.includes("could not fetch pull/42/head")),
      ).toBe(true);
    });
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();
  });

  it("shows an avatar, label pills, and a status badge on each PR row", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([samplePr]);
    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    });
    expect(screen.getByTitle("yarinmag")).toHaveTextContent("YA");
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByTestId("pr-status-badge")).toHaveTextContent("Open");
  });

  it("shows a Merged badge for a merged PR and a Draft badge for a draft PR", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([
      { ...samplePr, number: 43, state: "MERGED", isDraft: false, title: "Merged one" },
      { ...samplePr, number: 44, state: "OPEN", isDraft: true, title: "Draft one" },
    ]);
    render(<PullRequestsScreen />);
    await waitFor(() => {
      expect(screen.getByText("Merged one")).toBeInTheDocument();
    });
    const badges = screen.getAllByTestId("pr-status-badge").map((el) => el.textContent);
    expect(badges).toContain("Merged");
    expect(badges).toContain("Draft");
  });

  it("shows a disabled message when GitHub features are unavailable", () => {
    useGithubStore.setState({
      status: { available: false, owner: null, repo: null, reason: "origin remote is not a GitHub repository" },
    });
    render(<PullRequestsScreen />);
    expect(screen.getByText(/origin remote is not a GitHub repository/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });
  it("shows an empty state with a clear-filters action when no PRs match", async () => {
    (tauriLib.invokeListPullRequests as any).mockResolvedValue([]);
    useGithubStore.setState({ query: "author:nobody" });
    render(<PullRequestsScreen />);
    await waitFor(() => expect(screen.getByText("No pull requests match")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(useGithubStore.getState().query).toBe("");
  });

  it("gives actionable guidance when gh is not installed", () => {
    useGithubStore.setState({
      status: { available: false, owner: null, repo: null, reason: "failed to run gh: No such file or directory" },
    });
    render(<PullRequestsScreen />);
    expect(screen.getByText(/brew install gh/)).toBeInTheDocument();
  });
});
