import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useReleaseNotesHistoryStore } from "../store/releaseNotesHistoryStore";
import { invokeReleaseNotesCommits, type ReleaseNoteEntry } from "../lib/tauri";
import { formatReleaseNotes, releaseNotesToHtml, type ReleaseNoteCommit } from "../lib/releaseNotes";
import { copyRichWithToast } from "../lib/branchActions";
import { useRepoSettings } from "../hooks/useRepoSettings";
import { linkingConfigured } from "../lib/repoSettings";
import { toast } from "../store/toastStore";

// What the dialog body shows: the live generated notes, the saved-copies list,
// or one saved copy.
type View = { kind: "live" } | { kind: "list" } | { kind: "saved"; entry: ReleaseNoteEntry };

const footerButton = "px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover disabled:opacity-50";

export default function ReleaseNotesDialog() {
  const from = useReleaseNotesStore((s) => s.from);
  const to = useReleaseNotesStore((s) => s.to);
  const swap = useReleaseNotesStore((s) => s.swap);
  const clear = useReleaseNotesStore((s) => s.clear);
  const repoPath = useWorkspaceStore((s) => s.repos.find((r) => r.id === s.activeRepoId)?.path ?? null);
  const settings = useRepoSettings(repoPath);
  const canLink = linkingConfigured(settings);
  const [commits, setCommits] = useState<ReleaseNoteCommit[]>([]);
  const [dates, setDates] = useState(true);
  const [prNumbers, setPrNumbers] = useState(true);
  const [jiraLinks, setJiraLinks] = useState(true);
  // Hand edits to the text; any new query or option change starts over from the generated list.
  const [edited, setEdited] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>({ kind: "live" });
  const [historyError, setHistoryError] = useState<string | null>(null);
  const history = useReleaseNotesHistoryStore((s) => (repoPath ? s.byRepo[repoPath] : undefined)) ?? [];

  const linking = jiraLinks && canLink;
  const generated = useMemo(
    () =>
      formatReleaseNotes(commits, {
        dates,
        prNumbers,
        jiraLinks: linking,
        ticketPattern: settings.ticketPattern,
        jiraBaseUrl: settings.jiraBaseUrl,
      }),
    [commits, dates, prNumbers, linking, settings.ticketPattern, settings.jiraBaseUrl]
  );
  const text = edited ?? generated;
  const hasText = text.trim().length > 0;
  const live = view.kind === "live";

  // Copy the live text, then save it to history. A failed save only toasts.
  const copy = async () => {
    const ok = await copyRichWithToast(releaseNotesToHtml(text), text, "release notes");
    if (ok && repoPath && from && to) {
      await useReleaseNotesHistoryStore
        .getState()
        .add(repoPath, from.label, to.label, text)
        .catch(() => toast.error("Couldn't save to history"));
    }
  };
  const copySaved = (entry: ReleaseNoteEntry) =>
    copyRichWithToast(releaseNotesToHtml(entry.text), entry.text, "release notes");

  const openHistory = async () => {
    if (!repoPath) return;
    setHistoryError(null);
    setView({ kind: "list" });
    try {
      await useReleaseNotesHistoryStore.getState().load(repoPath);
    } catch {
      setHistoryError("Couldn't load history");
    }
  };
  const deleteSaved = async (entry: ReleaseNoteEntry) => {
    if (!repoPath) return;
    await useReleaseNotesHistoryStore
      .getState()
      .remove(repoPath, entry.id)
      .catch(() => toast.error("Couldn't delete that entry"));
    setView({ kind: "list" });
  };

  const open = !!(from && to);
  const fromOid = from?.oid;
  const toOid = to?.oid;

  useEffect(() => {
    if (!fromOid || !toOid || !repoPath) return;
    let cancelled = false;
    setView({ kind: "live" });
    // The previous range's notes (and any hand edit of them) must not stay copyable while the new range loads.
    setCommits([]);
    setEdited(null);
    setLoading(true);
    setError(null);
    invokeReleaseNotesCommits(repoPath, fromOid, toOid)
      .then((result) => {
        if (!cancelled) {
          setCommits(result);
          setEdited(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setCommits([]);
          setEdited(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, fromOid, toOid]);

  // Escape steps back (saved copy → list → live) before it closes the dialog.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (view.kind === "saved") setView({ kind: "list" });
      else if (view.kind === "list") setView({ kind: "live" });
      else clear();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, clear, view]);

  if (!from || !to) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6 animate-fade-in" onClick={clear}>
      <div
        role="dialog"
        aria-label="Release notes"
        className="w-full max-w-2xl rounded-lg border border-border-subtle bg-elevated p-4 shadow-xl text-sm text-text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-medium mb-1">Release notes</div>
        <div className="text-xs text-text-muted mb-2 truncate">
          after {from.label} → up to {to.label}
          {!loading && !error && <> · <span>{commits.length === 1 ? "1 commit" : `${commits.length} commits`}</span></>}
        </div>

        {view.kind === "list" ? (
          <div className="h-72 overflow-y-auto border border-border-subtle rounded bg-surface">
            {historyError ? (
              <div className="p-3 text-xs text-danger">{historyError}</div>
            ) : history.length === 0 ? (
              <div className="p-3 text-xs text-text-muted">Nothing saved yet. Copied notes appear here.</div>
            ) : (
              history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-hover border-b border-border-subtle truncate"
                  onClick={() => setView({ kind: "saved", entry })}
                >
                  {new Date(entry.createdAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · after{" "}
                  {entry.fromLabel} → {entry.toLabel}
                </button>
              ))
            )}
          </div>
        ) : (
          <>
            {view.kind === "saved" && (
              <div className="flex items-center gap-2 mb-1 text-xs text-text-muted">
                <span>
                  Saved copy from {new Date(view.entry.createdAt * 1000).toLocaleString()} · after {view.entry.fromLabel} →{" "}
                  {view.entry.toLabel}
                </span>
                <button type="button" className="underline hover:text-text-primary" onClick={() => setView({ kind: "live" })}>
                  Back to live
                </button>
              </div>
            )}
            <textarea
              readOnly={view.kind === "saved"}
              onChange={(e) => setEdited(e.target.value)}
              onKeyDown={(e) => {
                if (view.kind === "saved") return;
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && hasText) {
                  e.preventDefault();
                  void copy();
                  clear();
                }
              }}
              aria-label="Release notes text"
              value={view.kind === "saved" ? view.entry.text : loading ? "" : text}
              placeholder={loading ? "Loading…" : "No commits in this range"}
              className="w-full h-72 bg-surface border border-border-subtle rounded px-2 py-1 font-mono text-xs text-text-primary outline-none resize-none"
            />
            {error && live && <div className="text-xs text-danger mt-1 break-words">{error}</div>}
          </>
        )}

        <div className="flex items-center gap-2 mt-3">
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={dates}
              disabled={!live}
              onChange={(e) => {
                setDates(e.target.checked);
                setEdited(null);
              }}
            />
            Dates
          </label>
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={prNumbers}
              disabled={!live}
              onChange={(e) => {
                setPrNumbers(e.target.checked);
                setEdited(null);
              }}
            />
            PR numbers
          </label>
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={linking}
              disabled={!canLink || !live}
              title={canLink ? undefined : "Set a ticket pattern and Jira URL in Settings → Repository"}
              onChange={(e) => {
                setJiraLinks(e.target.checked);
                setEdited(null);
              }}
            />
            Jira links
          </label>
          <span className="flex-1" />
          <button type="button" disabled={!live} className={footerButton} onClick={swap}>
            Swap
          </button>
          {live && (
            <button type="button" disabled={!repoPath} className={footerButton} onClick={() => void openHistory()}>
              History
            </button>
          )}
          {view.kind === "list" && (
            <button type="button" className={footerButton} onClick={() => setView({ kind: "live" })}>
              Back to live
            </button>
          )}
          {view.kind === "saved" && (
            <button type="button" className={footerButton} onClick={() => void deleteSaved(view.entry)}>
              Delete
            </button>
          )}
          <button type="button" className={footerButton} onClick={clear}>
            Close
          </button>
          {view.kind !== "list" && (
            <button
              type="button"
              disabled={view.kind === "saved" ? false : !hasText}
              className="px-3 py-1 text-xs rounded bg-accent text-accent-contrast disabled:opacity-50"
              onClick={() => (view.kind === "saved" ? void copySaved(view.entry) : void copy())}
            >
              Copy
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
