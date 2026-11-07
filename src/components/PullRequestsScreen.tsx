import { useEffect, useState, type CSSProperties } from "react";
import { Loader2, Star, X, GitPullRequest, SearchX, PlugZap } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { toast } from "../store/toastStore";
import { describeGithubUnavailable } from "../lib/githubUnavailable";
import EmptyState from "./EmptyState";
import { usePinnedStore } from "../store/pinnedStore";
import { getQualifier } from "../lib/qualifierQuery";
import { getVisibleFilters, setVisibleFilters } from "../lib/visibleFilters";
import { hashHue } from "../lib/hashColor";
import { initials, statusLabel, checkStatusBadge, reviewDecisionBadge } from "../lib/prDisplay";
import BranchCombobox from "./BranchCombobox";
import UserCombobox from "./UserCombobox";
import DateRangeFilter from "./DateRangeFilter";
import FilterVisibilityMenu from "./FilterVisibilityMenu";
import PullRequestDetail from "./PullRequestDetail";

const SORT_OPTIONS = [
  { value: "created-desc", label: "Newest" },
  { value: "created-asc", label: "Oldest" },
  { value: "comments-desc", label: "Most commented" },
  { value: "comments-asc", label: "Least commented" },
  { value: "updated-desc", label: "Recently updated" },
];

const STATE_OPTIONS = [
  { value: "", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
  { value: "draft", label: "Draft" },
  { value: "all", label: "Any" },
];

const FILTER_DEFS: { key: string; label: string }[] = [
  { key: "author", label: "Author" },
  { key: "label", label: "Label" },
  { key: "assignee", label: "Assignee" },
  { key: "review-requested", label: "Reviewer" },
  { key: "project", label: "Project" },
  { key: "milestone", label: "Milestone" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
  { key: "base", label: "Base branch" },
  { key: "head", label: "Head branch" },
  { key: "state", label: "State" },
  { key: "sort", label: "Sort" },
];

function getStateValue(query: string): string {
  if (getQualifier(query, "state") === "all") return "all";
  const is = getQualifier(query, "is");
  return is === "closed" || is === "merged" || is === "draft" ? is : "";
}

export default function PullRequestsScreen() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const {
    query,
    setQuery,
    setQualifier,
    status,
    pullRequests,
    isLoadingPrs,
    searchPullRequests,
    openPullRequest,
    branches,
    isLoadingBranches,
    loadBranches,
    assignableUsers,
    isLoadingAssignableUsers,
    loadAssignableUsers,
    selectedPrNumber,
    openingPrNumber,
  } = useGithubStore();

  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const isPrPinned = usePinnedStore((s) => s.isPrPinned);
  const togglePr = usePinnedStore((s) => s.togglePr);
  const [visibleFilterKeys, setVisibleFilterKeys] = useState<string[]>(() => getVisibleFilters());

  useEffect(() => {
    if (activeRepo && (!status || status.available)) {
      searchPullRequests(activeRepo.path);
      loadBranches(activeRepo.path);
      loadAssignableUsers(activeRepo.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepo?.path, status?.available]);

  if (status && !status.available) {
    const info = describeGithubUnavailable(status.reason, status.owner != null);
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={<PlugZap size={18} />}
          title={info.title}
          hint={info.hint}
          details={status.reason ?? undefined}
        />
      </div>
    );
  }

  if (selectedPrNumber != null) {
    return <PullRequestDetail />;
  }

  const handleSearch = () => {
    if (!activeRepo) return;
    searchPullRequests(activeRepo.path);
  };

  const handleStateChange = (value: string) => {
    if (value === "all") {
      setQualifier("is", null);
      setQualifier("state", "all");
    } else if (value === "closed" || value === "merged" || value === "draft") {
      setQualifier("state", null);
      setQualifier("is", value);
    } else {
      setQualifier("state", null);
      setQualifier("is", null);
    }
  };

  const addFilter = (key: string) => {
    setVisibleFilterKeys((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      setVisibleFilters(next);
      return next;
    });
  };

  const removeFilter = (key: string) => {
    if (key === "state") {
      handleStateChange("");
    } else {
      setQualifier(key, null);
    }
    setVisibleFilterKeys((prev) => {
      const next = prev.filter((k) => k !== key);
      setVisibleFilters(next);
      return next;
    });
  };

  const toggleFilter = (key: string) => {
    if (visibleFilterKeys.includes(key)) {
      removeFilter(key);
    } else {
      addFilter(key);
    }
  };

  const handleRowClick = async (number: number) => {
    if (!activeRepo || openingPrNumber != null) return;
    try {
      await openPullRequest(activeRepo.path, number);
    } catch (e) {
      toast.error(`Couldn't open pull request #${number}: ${e}`);
    }
  };

  const renderFilterControl = (key: string) => {
    switch (key) {
      case "author":
        return (
          <UserCombobox
            value={getQualifier(query, "author")}
            onChange={(v) => setQualifier("author", v)}
            options={assignableUsers}
            isLoading={isLoadingAssignableUsers}
          />
        );
      case "label":
        return (
          <input
            className="w-28 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
            placeholder="Label"
            defaultValue={getQualifier(query, "label") ?? ""}
            onChange={(e) => setQualifier("label", e.target.value || null)}
          />
        );
      case "assignee":
        return (
          <UserCombobox
            value={getQualifier(query, "assignee")}
            onChange={(v) => setQualifier("assignee", v)}
            options={assignableUsers}
            isLoading={isLoadingAssignableUsers}
          />
        );
      case "review-requested":
        return (
          <UserCombobox
            value={getQualifier(query, "review-requested")}
            onChange={(v) => setQualifier("review-requested", v)}
            options={assignableUsers}
            isLoading={isLoadingAssignableUsers}
          />
        );
      case "project":
        return (
          <input
            className="w-24 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
            placeholder="Project"
            defaultValue={getQualifier(query, "project") ?? ""}
            onChange={(e) => setQualifier("project", e.target.value || null)}
          />
        );
      case "milestone":
        return (
          <input
            className="w-24 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
            placeholder="Milestone"
            defaultValue={getQualifier(query, "milestone") ?? ""}
            onChange={(e) => setQualifier("milestone", e.target.value || null)}
          />
        );
      case "created":
        return (
          <DateRangeFilter value={getQualifier(query, "created")} onChange={(v) => setQualifier("created", v)} />
        );
      case "updated":
        return (
          <DateRangeFilter value={getQualifier(query, "updated")} onChange={(v) => setQualifier("updated", v)} />
        );
      case "base":
        return (
          <BranchCombobox
            value={getQualifier(query, "base")}
            onChange={(v) => setQualifier("base", v)}
            branches={branches}
            isLoading={isLoadingBranches}
          />
        );
      case "head":
        return (
          <BranchCombobox
            value={getQualifier(query, "head")}
            onChange={(v) => setQualifier("head", v)}
            branches={branches}
            isLoading={isLoadingBranches}
          />
        );
      case "state": {
        const current = getStateValue(query);
        return (
          <div role="group" aria-label="State" className="flex rounded border border-border-subtle overflow-hidden">
            {STATE_OPTIONS.map((o, i) => (
              <button
                key={o.value}
                type="button"
                aria-label={o.label}
                aria-pressed={current === o.value}
                className={`px-2 py-1 text-xs ${i > 0 ? "border-l border-border-subtle" : ""} ${
                  current === o.value ? "bg-accent text-accent-contrast" : "bg-elevated text-text-primary"
                }`}
                onClick={() => handleStateChange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        );
      }
      case "sort":
        return (
          <select
            className="px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary"
            value={getQualifier(query, "sort") ?? ""}
            onChange={(e) => setQualifier("sort", e.target.value || null)}
          >
            <option value="">Default</option>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border-subtle text-xs">
        <input
          className="flex-1 min-w-40 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none"
          placeholder="is:open author:..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {FILTER_DEFS.filter((f) => visibleFilterKeys.includes(f.key)).map((f) => (
          <span key={f.key} className="flex items-center gap-1">
            <label className="flex items-center gap-1 text-text-muted">
              {f.label}
              {renderFilterControl(f.key)}
            </label>
            <button
              type="button"
              onClick={() => removeFilter(f.key)}
              aria-label={`Remove ${f.label} filter`}
              className="text-text-muted hover:text-danger"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <FilterVisibilityMenu filters={FILTER_DEFS} visible={visibleFilterKeys} onToggle={toggleFilter} />
        <button
          className="px-2 py-1 bg-accent text-accent-contrast rounded disabled:opacity-50 flex items-center gap-1 hover:brightness-110 press-scale"
          onClick={handleSearch}
          disabled={!activeRepo || isLoadingPrs}
        >
          {isLoadingPrs && <Loader2 size={12} className="animate-spin" />}
          Search
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!isLoadingPrs && pullRequests.length === 0 && (
          query.trim() ? (
            <EmptyState
              icon={<SearchX size={18} />}
              title="No pull requests match"
              hint="Try loosening the query or removing a filter."
              action={{
                label: "Clear filters",
                onClick: () => {
                  setQuery("");
                  handleSearch();
                },
              }}
            />
          ) : (
            <EmptyState
              icon={<GitPullRequest size={18} />}
              title="No pull requests"
              hint="This repository has no open pull requests."
            />
          )
        )}
        {pullRequests.map((pr) => {
          const prStatus = statusLabel(pr);
          const checkBadge = checkStatusBadge(pr.statusCheckRollup);
          const reviewBadge = reviewDecisionBadge(pr.reviewDecision);
          const isOpening = openingPrNumber === pr.number;
          const disabled = openingPrNumber != null;
          const pinned = status?.owner && status?.repo ? isPrPinned(status.owner, status.repo, pr.number) : false;
          return (
            <div
              key={pr.number}
              onClick={() => handleRowClick(pr.number)}
              className={`group px-3 py-2 border-b border-border-subtle flex items-center gap-3 transition-colors duration-100 ${
                disabled ? "cursor-wait" : "cursor-pointer hover:bg-hover"
              } ${disabled && !isOpening ? "opacity-50" : ""}`}
            >
              {status?.owner && status?.repo && (
                <button
                  className={`shrink-0 press-scale transition-opacity duration-100 ${pinned ? "text-accent" : "text-text-muted opacity-0 group-hover:opacity-100"}`}
                  title={pinned ? "Unpin PR" : "Pin PR"}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePr({ owner: status.owner!, repo: status.repo!, number: pr.number, title: pr.title });
                  }}
                >
                  <Star size={12} fill={pinned ? "currentColor" : "none"} />
                </button>
              )}
              <span
                className="flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold shrink-0 text-white"
                style={{ backgroundColor: `hsl(${hashHue(pr.author)}, 55%, 45%)` }}
                title={pr.author}
              >
                {initials(pr.author)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium truncate text-text-primary">{pr.title}</span>
                  {pr.labels.map((label) => (
                    <span
                      key={label}
                      className="label-pill text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{ "--label-h": hashHue(label) } as CSSProperties}
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <div className="text-text-muted text-xs truncate" data-testid="pr-row-detail">
                  #{pr.number} by {pr.author} ·{" "}
                  <span className="px-1 rounded bg-elevated text-text-primary font-mono">{pr.baseRefName}</span> ←{" "}
                  <span className="px-1 rounded bg-elevated text-text-primary font-mono">{pr.headRefName}</span> ·{" "}
                  {pr.state}
                  {pr.isDraft ? " (draft)" : ""}
                  {pr.labels.length > 0 ? ` · ${pr.labels.join(", ")}` : ""}
                </div>
              </div>
              {isOpening ? (
                <span className="flex items-center gap-1 text-[11px] text-text-muted shrink-0">
                  <Loader2 size={12} className="animate-spin" /> Opening…
                </span>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  {checkBadge && (
                    <span
                      data-testid="pr-check-badge"
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${checkBadge.className}`}
                    >
                      {checkBadge.label}
                    </span>
                  )}
                  {reviewBadge && (
                    <span
                      data-testid="pr-review-badge"
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${reviewBadge.className}`}
                    >
                      {reviewBadge.label}
                    </span>
                  )}
                  <span
                    data-testid="pr-status-badge"
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${prStatus.className}`}
                  >
                    {prStatus.label}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
