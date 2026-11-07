import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, RefreshCw, Star } from "lucide-react";
import type { CiJob, CiWorkflowRun } from "../lib/tauri";
import { sortRuns } from "../lib/ci";
import { describeGithubUnavailable } from "../lib/githubUnavailable";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useShortcut } from "../hooks/useKeyboardShortcuts";
import { useUiStore } from "../store/uiStore";
import { useCiChecksStore, CI_CHECKS_POLL_MS } from "../store/ciChecksStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { toast } from "../store/toastStore";
import EmptyState from "./EmptyState";
import { SkeletonBlock } from "./Skeleton";
import WorkflowCard, { StateIcon } from "./WorkflowCard";

interface Props {
  oid: string;
  onOpenJob: (job: CiJob, run: CiWorkflowRun) => void;
}

export function useCiShortcuts({ enabled, onToggleFavoritesOnly }: { enabled: boolean; onToggleFavoritesOnly: () => void }) {
  const setDrawerTab = useUiStore((s) => s.setDrawerTab);
  useShortcut(
    { id: "ci.open-checks", keys: ["c"], display: "c", description: "Open checks for the selected commit", group: "CI" },
    () => setDrawerTab("checks"),
    enabled
  );
  useShortcut(
    { id: "ci.favorites-only", keys: ["f"], display: "f", description: "Toggle favorite workflows only", group: "CI" },
    () => {
      if (useUiStore.getState().drawerTab === "checks") onToggleFavoritesOnly();
    },
    enabled
  );
}

export default function ChecksPanel({ oid, onOpenJob }: Props) {
  const repoPath = useWorkspaceStore((s) => s.repos.find((r) => r.id === s.activeRepoId)?.path);
  const storeChecks = useCiChecksStore((s) => s.checks);
  const storeOid = useCiChecksStore((s) => s.oid);
  const checks = storeChecks?.oid === oid ? storeChecks : null;
  const loading = useCiChecksStore((s) => s.loading);
  const storeError = useCiChecksStore((s) => s.error);
  const error = storeOid === oid ? storeError : null;
  const load = useCiChecksStore((s) => s.load);
  const refresh = useCiChecksStore((s) => s.refresh);
  const prefs = useCiPrefsStore((s) => (repoPath ? s.getPrefs(repoPath) : undefined));
  const setFavoritesOnly = useCiPrefsStore((s) => s.setFavoritesOnly);

  useEffect(() => {
    if (repoPath) void load(repoPath, oid);
  }, [repoPath, oid, load]);

  const anyRunning = !!checks?.runs.some((r) => r.status !== "completed");
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, CI_CHECKS_POLL_MS);
    return () => clearInterval(id);
  }, [anyRunning, refresh]);

  if (!repoPath) return null;
  const retry = () => void load(repoPath, oid);

  if (error) {
    const { kind, message } = error;
    if (kind === "no-gh" || kind === "unauthenticated") {
      const info = describeGithubUnavailable(message, kind === "unauthenticated");
      return <EmptyState variant="error" title={info.title} hint={info.hint} />;
    }
    if (kind === "rate-limited") {
      return (
        <EmptyState variant="error" title="GitHub rate limit reached" hint="Try again in a few minutes" action={{ label: "Retry", onClick: retry }} />
      );
    }
    if (kind === "forbidden") {
      return <EmptyState variant="error" title="Not allowed" hint="Your GitHub account can't view checks for this repository." />;
    }
    return <EmptyState variant="error" title="Couldn't load checks" details={message} action={{ label: "Retry", onClick: retry }} />;
  }

  if (!checks) {
    return loading ? <SkeletonBlock lines={4} /> : null;
  }

  const favoritesOnly = !!prefs?.favoritesOnly;
  const favorites = prefs?.favorites ?? [];
  const empty = checks.runs.length === 0 && checks.other.length === 0;
  const sorted = sortRuns(checks.runs);
  const visible = favoritesOnly && favorites.length > 0 ? sorted.filter((r) => favorites.includes(r.workflowId)) : sorted;
  const hidden = favoritesOnly ? sorted.length - visible.length : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Favorites only"
          aria-pressed={favoritesOnly}
          title="Show favorite workflows only"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs press-scale ${
            favoritesOnly ? "border-accent text-text-primary bg-hover" : "border-border-subtle text-text-muted hover:text-text-primary"
          }`}
          onClick={() => setFavoritesOnly(repoPath, !favoritesOnly)}
        >
          <Star size={12} fill={favoritesOnly ? "currentColor" : "none"} /> Favorites
        </button>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Refresh checks"
          title="Refresh checks"
          className="text-text-muted hover:text-text-primary press-scale"
          onClick={() => void refresh()}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      {empty ? (
        <EmptyState compact title="No CI on this commit" />
      ) : (
        <>
          {favoritesOnly && favorites.length === 0 ? (
            <EmptyState compact title="Star a workflow to see it here" action={{ label: "Show all", onClick: () => setFavoritesOnly(repoPath, false) }} />
          ) : favoritesOnly && visible.length === 0 && sorted.length > 0 ? (
            <EmptyState compact title="None of your favorite workflows ran on this commit" action={{ label: "Show all", onClick: () => setFavoritesOnly(repoPath, false) }} />
          ) : (
            visible.map((run) => <WorkflowCard key={run.runId} repoPath={repoPath} run={run} onOpenJob={onOpenJob} />)
          )}
          {favoritesOnly && hidden > 0 && visible.length > 0 && <div className="text-xs text-text-muted">{hidden} hidden</div>}
          {!favoritesOnly && checks.other.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-xs font-medium text-text-muted">Other checks</div>
              {checks.other.map((c, i) => (
                <div key={`${c.name}-${i}`} className="flex items-center gap-2 text-xs px-1">
                  <StateIcon state={c.state} size={12} />
                  <span className="flex-1 min-w-0 truncate text-text-primary">{c.name}</span>
                  <span className="text-text-muted">{c.source}</span>
                  {c.url && (
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-primary press-scale"
                      aria-label={`Open ${c.name}`}
                      onClick={() => openUrl(c.url as string).catch((err) => toast.error(`Failed to open check: ${err}`))}
                    >
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
