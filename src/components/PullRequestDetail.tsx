import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, MessageSquare } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { usePrDiffStore } from "../store/prDiffStore";
import { toast } from "../store/toastStore";
import EmptyState from "./EmptyState";
import { hashHue } from "../lib/hashColor";
import { initials, statusLabel } from "../lib/prDisplay";
import Markdown from "./Markdown";
import FilesChangedTab from "./FilesChangedTab";
import ChecksPanel from "./ChecksPanel";
import LogViewer from "./LogViewer";
import type { CiJob, CiWorkflowRun } from "../lib/tauri";

export default function PullRequestDetail() {
  const { activeRepoId, repos } = useWorkspaceStore();
  const { selectedPrNumber, prDetail, prComments, addComment, closePullRequestDetail, openPullRequest, status } =
    useGithubStore();
  const { diff, loadDiff } = usePrDiffStore();
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const [activeTab, setActiveTab] = useState<"conversation" | "commits" | "files" | "checks">("conversation");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openJob, setOpenJob] = useState<{ job: CiJob; run: CiWorkflowRun } | null>(null);

  useEffect(() => {
    if (activeTab === "files" && !diff && activeRepo && selectedPrNumber != null && prDetail) {
      loadDiff(activeRepo.path, selectedPrNumber, prDetail.pullRequest.baseRefName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedPrNumber]);

  if (!prDetail || selectedPrNumber == null) return null;
  const pr = prDetail.pullRequest;
  const prStatus = statusLabel(pr);
  const headOid = status?.available ? prDetail.commits[prDetail.commits.length - 1]?.oid : undefined;

  const handleSubmit = async () => {
    if (!activeRepo || !draft.trim()) return;
    setPosting(true);
    try {
      await addComment(activeRepo.path, draft);
      setDraft("");
      toast.success("Comment posted");
    } catch (e) {
      toast.error(`Failed to post comment: ${e}`);
    } finally {
      setPosting(false);
    }
  };

  const handleRefresh = async () => {
    if (!activeRepo || selectedPrNumber == null) return;
    setRefreshing(true);
    try {
      await openPullRequest(activeRepo.path, selectedPrNumber);
      if (diff) {
        await loadDiff(activeRepo.path, selectedPrNumber, pr.baseRefName);
      }
    } catch (e) {
      toast.error(`Failed to refresh pull request: ${e}`);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
          onClick={closePullRequestDetail}
        >
          <ArrowLeft size={14} /> Back to Pull Requests
        </button>
        <div className="flex-1" />
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-50"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh — picks up new comments/activity from GitHub"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      <div className="px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold shrink-0 text-white"
            style={{ backgroundColor: `hsl(${hashHue(pr.author)}, 55%, 45%)` }}
            title={pr.author}
          >
            {initials(pr.author)}
          </span>
          <span className="font-medium text-text-primary">
            #{pr.number} {pr.title}
          </span>
          <span data-testid="pr-status-badge" className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${prStatus.className}`}>
            {prStatus.label}
          </span>
        </div>
        <div className="text-xs text-text-muted mt-1">
          <code>{pr.baseRefName}</code> ← <code>{pr.headRefName}</code>
        </div>
      </div>
      <div className="flex border-b border-border-subtle">
        <button
          type="button"
          className={`px-3 py-2 text-xs font-medium border-b-2 ${
            activeTab === "conversation" ? "border-accent text-text-primary" : "border-transparent text-text-muted"
          }`}
          onClick={() => setActiveTab("conversation")}
        >
          Conversation
        </button>
        <button
          type="button"
          className={`px-3 py-2 text-xs font-medium border-b-2 ${
            activeTab === "commits" ? "border-accent text-text-primary" : "border-transparent text-text-muted"
          }`}
          onClick={() => setActiveTab("commits")}
        >
          Commits ({prDetail.commits.length})
        </button>
        <button
          type="button"
          className={`px-3 py-2 text-xs font-medium border-b-2 ${
            activeTab === "files" ? "border-accent text-text-primary" : "border-transparent text-text-muted"
          }`}
          onClick={() => setActiveTab("files")}
        >
          Files changed
        </button>
        {headOid && (
          <button
            type="button"
            className={`px-3 py-2 text-xs font-medium border-b-2 ${
              activeTab === "checks" ? "border-accent text-text-primary" : "border-transparent text-text-muted"
            }`}
            onClick={() => setActiveTab("checks")}
          >
            Checks
          </button>
        )}
      </div>
      {activeTab === "conversation" && (
      // Cards below need shrink-0 — without it, flexbox's default shrink
      // behavior squeezes them to fit this container's height instead of
      // letting them keep their natural size, which silently clips long
      // bodies/comments via their own overflow-hidden instead of this
      // container's overflow-y-auto actually scrolling.
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {prDetail.body.trim() && (
          <div className="shrink-0 border border-border-subtle rounded-md overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-elevated border-b border-border-subtle text-xs text-text-muted">
              <span
                className="flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold shrink-0 text-white"
                style={{ backgroundColor: `hsl(${hashHue(pr.author)}, 55%, 45%)` }}
                title={pr.author}
              >
                {initials(pr.author)}
              </span>
              <span className="font-medium text-text-primary">{pr.author}</span> commented
            </div>
            <div className="px-4 py-3 markdown-body">
              <Markdown>{prDetail.body}</Markdown>
            </div>
          </div>
        )}
        {prComments.length === 0 ? (
          <EmptyState compact icon={<MessageSquare size={14} />} title="No comments yet" hint="Start the conversation below." />
        ) : (
          prComments.map((comment) => (
            <div key={comment.id} className="shrink-0 border border-border-subtle rounded-md overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-elevated border-b border-border-subtle text-xs text-text-muted">
                <span
                  className="flex items-center justify-center w-5 h-5 rounded-full text-[8px] font-semibold shrink-0 text-white"
                  style={{ backgroundColor: `hsl(${hashHue(comment.author)}, 55%, 45%)` }}
                  title={comment.author}
                >
                  {initials(comment.author)}
                </span>
                <span className="font-medium text-text-primary">{comment.author}</span> commented · {comment.createdAt}
              </div>
              <div className="px-4 py-3 markdown-body">
                <Markdown>{comment.body}</Markdown>
              </div>
            </div>
          ))
        )}
      </div>
      )}
      {activeTab === "commits" && (
        <div className="flex-1 overflow-y-auto">
          {prDetail.commits.map((commit) => {
            const githubUrl =
              status?.available && status.owner && status.repo
                ? `https://github.com/${status.owner}/${status.repo}/commit/${commit.oid}`
                : null;
            return (
              <div
                key={commit.oid}
                className="px-4 py-2 border-b border-border-subtle flex items-center gap-2 text-sm"
              >
                <span className="flex-1 truncate text-text-primary">{commit.messageHeadline}</span>
                {githubUrl ? (
                  <button
                    className="text-text-muted hover:text-accent font-mono text-xs"
                    onClick={() => openUrl(githubUrl).catch((err) => toast.error(`Failed to open commit: ${err}`))}
                    title="Open commit on GitHub"
                  >
                    {commit.oid.slice(0, 7)}
                  </button>
                ) : (
                  <span className="text-text-muted font-mono text-xs">{commit.oid.slice(0, 7)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {activeTab === "files" && <FilesChangedTab />}
      {activeTab === "checks" && headOid && (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <ChecksPanel oid={headOid} onOpenJob={(job, run) => setOpenJob({ job, run })} />
        </div>
      )}
      {activeTab === "conversation" && (
      <div className="border-t border-border-subtle p-3 flex flex-col gap-2">
        <textarea
          className="w-full min-h-20 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary outline-none text-sm"
          placeholder="Leave a comment"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div>
          <button
            type="button"
            className="px-3 py-1.5 bg-accent text-accent-contrast rounded text-xs font-medium disabled:opacity-50"
            onClick={handleSubmit}
            disabled={posting || !draft.trim()}
          >
            Comment
          </button>
        </div>
      </div>
      )}
      {openJob && activeRepo && (
        <LogViewer repoPath={activeRepo.path} job={openJob.job} run={openJob.run} onClose={() => setOpenJob(null)} />
      )}
    </div>
  );
}
