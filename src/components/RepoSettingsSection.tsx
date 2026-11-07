import { useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { DEFAULT_REPO_SETTINGS, ticketPatternError, type RepoSettings } from "../lib/repoSettings";
import { toast } from "../store/toastStore";

interface Props {
  /** Repo to show first; falls back to the first repo. */
  initialRepoPath?: string | null;
  /** Scroll this section into view on mount (used when opened for a specific repo). */
  scrollIntoView?: boolean;
}

const inputClass =
  "w-full bg-elevated border border-border-subtle rounded px-2 py-1 text-xs text-text-primary outline-none";

export default function RepoSettingsSection({ initialRepoPath, scrollIntoView }: Props) {
  const repos = useWorkspaceStore((s) => s.repos);
  const [repoPath, setRepoPath] = useState(initialRepoPath ?? repos[0]?.path ?? "");
  const stored = useRepoSettingsStore((s) => (repoPath ? s.byPath[repoPath] : undefined));
  const [form, setForm] = useState<RepoSettings>(DEFAULT_REPO_SETTINGS);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollIntoView) rootRef.current?.scrollIntoView?.({ block: "start" });
  }, [scrollIntoView]);

  useEffect(() => {
    if (repoPath) void useRepoSettingsStore.getState().load(repoPath);
  }, [repoPath]);

  // Refill the form whenever a different repo is picked or its stored settings arrive/change.
  useEffect(() => {
    if (stored) setForm(stored);
    setSaveError(null);
  }, [repoPath, stored]);

  if (repos.length === 0) {
    return (
      <div>
        <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Repository</div>
        <div className="text-xs text-text-muted">Add a repository to configure it.</div>
      </div>
    );
  }

  const loading = !stored;
  const patternError = ticketPatternError(form.ticketPattern);
  const set = (patch: Partial<RepoSettings>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (busy || loading || patternError || !repoPath) return;
    setBusy(true);
    setSaveError(null);
    try {
      const storedValue = await useRepoSettingsStore.getState().save(repoPath, form);
      setForm(storedValue);
      toast.success("Saved repo settings");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy || loading || !repoPath) return;
    setBusy(true);
    setSaveError(null);
    try {
      await useRepoSettingsStore.getState().reset(repoPath);
      setForm(DEFAULT_REPO_SETTINGS);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wide text-text-muted">
        Repository{loading ? " — loading…" : ""}
      </div>
      <select
        aria-label="Repository"
        value={repoPath}
        onChange={(e) => setRepoPath(e.target.value)}
        className={inputClass}
      >
        {repos.map((r) => (
          <option key={r.id} value={r.path}>
            {r.name}
          </option>
        ))}
      </select>

      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Ticket pattern (regex)
        <input
          aria-label="Ticket pattern"
          disabled={loading}
          value={form.ticketPattern}
          onChange={(e) => set({ ticketPattern: e.target.value })}
          placeholder="CEM-\d+"
          className={`${inputClass} font-mono`}
        />
        {patternError && <span className="text-danger">{patternError}</span>}
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Jira base URL
        <input
          aria-label="Jira base URL"
          disabled={loading}
          value={form.jiraBaseUrl}
          onChange={(e) => set({ jiraBaseUrl: e.target.value })}
          placeholder="https://your-org.atlassian.net/browse/"
          className={`${inputClass} font-mono`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Worktree folder (absolute path; empty = next to the repo)
        <input
          aria-label="Worktree folder"
          disabled={loading}
          value={form.worktreeDir}
          onChange={(e) => set({ worktreeDir: e.target.value })}
          className={`${inputClass} font-mono`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Release tag pattern (glob)
        <input
          aria-label="Release tag pattern"
          disabled={loading}
          value={form.releaseTagPattern}
          onChange={(e) => set({ releaseTagPattern: e.target.value })}
          placeholder="beta-ota-v-mobile-*"
          className={`${inputClass} font-mono`}
        />
        <span>e.g. beta-ota-v-mobile-*. Empty = any tag.</span>
      </label>
      <div className="text-xs text-text-muted">Clear the pattern or the URL to turn Jira links off for this repo.</div>
      {saveError && <div className="text-xs text-danger break-words">{saveError}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy || loading}
          className="px-3 py-1 text-xs rounded border border-border-subtle hover:bg-hover disabled:opacity-50"
          onClick={() => void reset()}
        >
          Reset to defaults
        </button>
        <button
          type="button"
          disabled={busy || loading || !!patternError}
          className="px-3 py-1 text-xs rounded bg-accent text-accent-contrast disabled:opacity-50"
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </div>
  );
}
