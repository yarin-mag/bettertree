import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppWindow, Check, ChevronDown, ChevronUp, Copy, ExternalLink, GitPullRequest, Globe, Loader2, Maximize2, Minimize2, X } from "lucide-react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { useUiStore } from "../store/uiStore";
import { openUrl } from "@tauri-apps/plugin-opener";
import { copyText } from "../lib/clipboard";
import { usePrOpenPreferenceStore } from "../store/prOpenPreferenceStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { useViewStore } from "../store/viewStore";
import { invokeGetCommitDiff, invokeListCommitPullRequests, type CommitPullRequest, type CommitDetail, type CiJob, type CiWorkflowRun } from "../lib/tauri";
import DiffViewer from "./DiffViewer";
import ResizeHandle from "./ResizeHandle";
import ResizableModal from "./ResizableModal";
import { useResizable } from "../hooks/useResizable";
import { SkeletonLine, SkeletonBlock } from "./Skeleton";
import ChecksPanel, { useCiShortcuts } from "./ChecksPanel";
import LogViewer from "./LogViewer";
import CiBadge, { useCiBadge } from "./CiBadge";

const MIN_HEIGHT = 120;
// The drawer may grow with the window instead of stopping at a fixed height.
const maxDrawerHeight = () => Math.max(MIN_HEIGHT + 120, Math.round(window.innerHeight * 0.8));

const COPIED_FEEDBACK_MS = 1500;

function CopyShaButton({ oid }: { oid: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const handleCopy = async () => {
    if (!(await copyText(oid))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };
  return (
    <button
      className={`${HEADER_BUTTON} ${copied ? "!text-success !border-success" : ""}`}
      title="Copy full SHA"
      onClick={handleCopy}
    >
      {oid.slice(0, 7)}
      {copied ? (
        <>
          <Check size={12} className="animate-pop-in" /> Copied
        </>
      ) : (
        <Copy size={12} />
      )}
    </button>
  );
}

const HEADER_BUTTON =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border-subtle bg-elevated text-text-muted hover:text-text-primary hover:bg-hover hover:border-accent transition-colors duration-100 press-scale disabled:opacity-60";

function DrawerTabs({ oid }: { oid: string }) {
  const drawerTab = useUiStore((s) => s.drawerTab);
  const setDrawerTab = useUiStore((s) => s.setDrawerTab);
  const badge = useCiBadge(oid);
  const tab = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 ${
      active ? "border-accent text-text-primary" : "border-transparent text-text-muted hover:text-text-primary"
    }`;
  return (
    <div role="tablist" className="flex border-b border-border-subtle mb-2">
      <button type="button" role="tab" aria-selected={drawerTab === "diff"} className={tab(drawerTab === "diff")} onClick={() => setDrawerTab("diff")}>
        Changes
      </button>
      <button type="button" role="tab" aria-selected={drawerTab === "checks"} className={tab(drawerTab === "checks")} onClick={() => setDrawerTab("checks")}>
        Checks
        <CiBadge state={badge.state} title={badge.title} interactive={false} />
      </button>
    </div>
  );
}

function PrChoiceDialog({
  prs,
  onOpenInApp,
  onOpenInBrowser,
  onClose,
}: {
  prs: CommitPullRequest[];
  onOpenInApp: (pr: CommitPullRequest, remember: boolean) => void;
  onOpenInBrowser: (pr: CommitPullRequest, remember: boolean) => void;
  onClose: () => void;
}) {
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Open pull request"
        className="w-full max-w-md bg-surface border border-border-subtle rounded-lg shadow-2xl p-4 flex flex-col gap-3 animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-text-primary">Open pull request</div>
          <button
            className="text-text-muted hover:text-text-primary press-scale"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        {prs.map((pr) => (
          <div key={pr.number} className="flex flex-col gap-2 rounded border border-border-subtle p-2">
            <div className="text-xs text-text-primary">
              <span className="font-mono text-text-muted">#{pr.number}</span> {pr.title}
            </div>
            <div className="flex gap-2">
              <button className={HEADER_BUTTON} onClick={() => onOpenInApp(pr, remember)}>
                <GitPullRequest size={12} /> Open in app
              </button>
              <button className={HEADER_BUTTON} onClick={() => onOpenInBrowser(pr, remember)}>
                <Globe size={12} /> Open in browser
              </button>
            </div>
          </div>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Don&apos;t ask me again
        </label>
      </div>
    </div>,
    document.body
  );
}

function OpenPrButton({ repoPath, oid, onNavigate }: { repoPath: string; oid: string; onNavigate: () => void }) {
  const [state, setState] = useState<"idle" | "loading" | "none" | "error">("idle");
  const [prs, setPrs] = useState<CommitPullRequest[] | null>(null);
  const setActiveView = useViewStore((s) => s.setActiveView);
  const openPullRequest = useGithubStore((s) => s.openPullRequest);
  const { preference, setPreference } = usePrOpenPreferenceStore();
  useEffect(() => {
    setState("idle");
    setPrs(null);
  }, [oid]);

  const handleClick = async () => {
    setState("loading");
    try {
      const found = await invokeListCommitPullRequests(repoPath, oid);
      if (found.length === 0) {
        setState("none");
        return;
      }
      setState("idle");
      if (found.length === 1 && preference === "app") {
        await openInApp(found[0], false);
      } else if (found.length === 1 && preference === "browser") {
        openInBrowser(found[0], false);
      } else {
        setPrs(found);
      }
    } catch {
      setState("error");
    }
  };

  const openInApp = async (pr: CommitPullRequest, remember: boolean) => {
    if (remember) setPreference("app");
    setPrs(null);
    onNavigate();
    setActiveView("pulls");
    try {
      await openPullRequest(repoPath, pr.number);
    } catch {
      setState("error");
    }
  };

  const openInBrowser = (pr: CommitPullRequest, remember: boolean) => {
    if (remember) setPreference("browser");
    setPrs(null);
    openUrl(pr.url).catch((err) => console.error("failed to open pull request:", err));
  };

  return (
    <>
      <button
        className={`${HEADER_BUTTON} ${state === "error" ? "!text-danger" : ""}`}
        title="Open the pull request containing this commit"
        disabled={state === "loading"}
        onClick={handleClick}
      >
        {state === "loading" ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />}
        {state === "none" ? "No PR found" : state === "error" ? "PR lookup failed" : "Pull request"}
      </button>
      {prs && (
        <PrChoiceDialog
          prs={prs}
          onOpenInApp={openInApp}
          onOpenInBrowser={openInBrowser}
          onClose={() => setPrs(null)}
        />
      )}
    </>
  );
}

export default function CommitDrawer() {
  const { activeRepoId, repos, commits } = useWorkspaceStore();
  const githubStatus = useGithubStore((s) => s.status);
  const { selectedCommitOid, selectCommit, setLoadingCommit } = useUiStore();
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRepo = repos.find((r) => r.id === activeRepoId);
  const { size, onMouseDown } = useResizable(320, MIN_HEIGHT, maxDrawerHeight(), "y", true);
  const [maximized, setMaximized] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const requestOidRef = useRef<string | null>(null);
  const drawerTab = useUiStore((s) => s.drawerTab);
  const [openJob, setOpenJob] = useState<{ job: CiJob; run: CiWorkflowRun } | null>(null);

  useEffect(() => {
    requestOidRef.current = selectedCommitOid;
    if (!activeRepo || !selectedCommitOid) {
      setDetail(null);
      setError(null);
      setLoadingCommit(false);
      return;
    }
    setError(null);
    setLoadingCommit(true);
    invokeGetCommitDiff(activeRepo.path, selectedCommitOid)
      .then((result) => {
        if (requestOidRef.current !== selectedCommitOid) return;
        setDetail(result);
      })
      .catch((e) => {
        if (requestOidRef.current !== selectedCommitOid) return;
        setDetail(null);
        setError(String(e));
      })
      .finally(() => {
        if (requestOidRef.current !== selectedCommitOid) return;
        setLoadingCommit(false);
      });
  }, [activeRepo?.path, selectedCommitOid, setLoadingCommit]);

  useCiShortcuts({
    enabled: !!selectedCommitOid && !!githubStatus?.available,
    onToggleFavoritesOnly: () => {
      if (!activeRepo) return;
      const prefs = useCiPrefsStore.getState();
      prefs.setFavoritesOnly(activeRepo.path, !prefs.getPrefs(activeRepo.path).favoritesOnly);
    },
  });

  useEffect(() => {
    if (!modalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen]);

  if (!selectedCommitOid) return null;

  if (error) {
    return (
      <div className="border-t border-border-subtle bg-surface p-3 text-sm text-danger">
        Failed to load commit: {error}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="border-t border-border-subtle bg-surface p-3 flex flex-col gap-2">
        <SkeletonLine width="35%" height="1rem" />
        <SkeletonLine width="55%" />
        <div className="mt-2">
          <SkeletonBlock lines={4} />
        </div>
      </div>
    );
  }

  const date = new Date(detail.timestamp * 1000).toLocaleString();
  const commitIndex = commits.findIndex((c) => c.oid === selectedCommitOid);
  const prevCommit = commitIndex >= 0 ? commits[commitIndex - 1] : undefined;
  const nextCommit = commitIndex >= 0 ? commits[commitIndex + 1] : undefined;
  const githubUrl =
    githubStatus?.available && githubStatus.owner && githubStatus.repo
      ? `https://github.com/${githubStatus.owner}/${githubStatus.repo}/commit/${detail.oid}`
      : null;

  const showTabs = !!githubStatus?.available;
  const tabs = showTabs ? <DrawerTabs oid={detail.oid} /> : null;
  const body =
    showTabs && drawerTab === "checks" ? (
      <ChecksPanel oid={detail.oid} onOpenJob={(job, run) => setOpenJob({ job, run })} />
    ) : (
      <DiffViewer files={detail.files} />
    );
  // The modal renders its own copy of the body; keep only one mounted so only one ChecksPanel polls.
  const inlineBody = modalOpen && showTabs && drawerTab === "checks" ? null : body;

  const commitHeader = (
    <div>
      <div className="font-medium text-text-primary">{detail.message}</div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted font-mono">
        <span>
          {detail.author} &lt;{detail.email}&gt; — {date}
        </span>
        <CopyShaButton oid={detail.oid} />
        {githubUrl && (
          <button
            className={HEADER_BUTTON}
            onClick={() => openUrl(githubUrl).catch((err) => console.error("failed to open commit on GitHub:", err))}
            title="Open commit on GitHub"
          >
            <ExternalLink size={12} /> Commit on GitHub
          </button>
        )}
        {githubStatus?.available && activeRepo && (
          <OpenPrButton repoPath={activeRepo.path} oid={detail.oid} onNavigate={() => setModalOpen(false)} />
        )}
      </div>
      {detail.parents.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-text-muted font-mono mt-0.5">
          Parent{detail.parents.length > 1 ? "s" : ""}:
          {detail.parents.map((oid) => (
            <button key={oid} className="hover:text-accent hover:underline" onClick={() => selectCommit(oid)}>
              {oid.slice(0, 7)}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div
        className="relative border-t border-border-subtle bg-surface overflow-y-auto p-3 flex-shrink-0"
        style={{ height: maximized ? "85vh" : size }}
      >
        {!maximized && <ResizeHandle axis="y" edge="start" onMouseDown={onMouseDown} />}
        <div className="flex justify-between items-start mb-2">
          {commitHeader}
          <div className="flex items-center gap-2">
            <button
              className="text-text-muted hover:text-text-primary disabled:opacity-30 press-scale"
              onClick={() => nextCommit && selectCommit(nextCommit.oid)}
              disabled={!nextCommit}
              aria-label="Older commit"
              title="Older commit"
            >
              <ChevronDown size={14} />
            </button>
            <button
              className="text-text-muted hover:text-text-primary disabled:opacity-30 press-scale"
              onClick={() => prevCommit && selectCommit(prevCommit.oid)}
              disabled={!prevCommit}
              aria-label="Newer commit"
              title="Newer commit"
            >
              <ChevronUp size={14} />
            </button>
            <button
              className="text-text-muted hover:text-text-primary press-scale"
              onClick={() => setModalOpen(true)}
              aria-label="Open in modal"
              title="Open in modal"
            >
              <AppWindow size={14} />
            </button>
            <button
              className="text-text-muted hover:text-text-primary press-scale"
              onClick={() => setMaximized((m) => !m)}
              aria-label={maximized ? "Restore" : "Maximize"}
            >
              {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              className="text-text-muted hover:text-text-primary press-scale"
              onClick={() => selectCommit(null)}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        {tabs}
        {inlineBody}
      </div>
      {modalOpen && (
        <ResizableModal onClose={() => setModalOpen(false)} label="Commit" header={commitHeader}>
          {tabs}
          <div className="overflow-y-auto flex-1">{body}</div>
        </ResizableModal>
      )}
      {openJob && activeRepo && (
        <LogViewer repoPath={activeRepo.path} job={openJob.job} run={openJob.run} onClose={() => setOpenJob(null)} />
      )}
    </>
  );
}
