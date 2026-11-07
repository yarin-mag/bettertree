import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { CiState } from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useCiStatusStore } from "../store/ciStatusStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import { badgeState, badgeTitle } from "../lib/ci";

const LABELS: Record<Exclude<CiState, "none">, string> = { success: "CI passed", failure: "CI failed", pending: "CI running" };

export function useCiBadge(oid: string | undefined): { state: CiState; title: string } {
  const repoPath = useWorkspaceStore((s) => s.repos.find((r) => r.id === s.activeRepoId)?.path);
  const ci = useCiStatusStore((s) => (oid ? s.byOid[oid] : undefined));
  const prefs = useCiPrefsStore((s) => (repoPath ? s.getPrefs(repoPath) : undefined));
  if (!ci) return { state: "none", title: "" };
  const follow = !!prefs?.favoritesOnly && prefs.badgeFollowsFavorites;
  const opts = { favorites: prefs?.favorites ?? [], followFavorites: follow };
  return { state: badgeState(ci, opts), title: badgeTitle(ci, opts) };
}

export default function CiBadge({ state, title, onClick, interactive = true }: { state: CiState; title?: string; onClick?: () => void; interactive?: boolean }) {
  if (state === "none") return null;
  const Icon = state === "success" ? CheckCircle2 : state === "failure" ? XCircle : Loader2;
  const color = state === "success" ? "text-success" : state === "failure" ? "text-danger" : "text-merged";
  if (!interactive) {
    return (
      <span aria-label={LABELS[state]} title={title || LABELS[state]} className={`shrink-0 ${color}`}>
        <Icon size={12} className={state === "pending" ? "animate-spin" : ""} />
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={LABELS[state]}
      title={title || LABELS[state]}
      className={`shrink-0 press-scale ${color}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <Icon size={12} className={state === "pending" ? "animate-spin" : ""} />
    </button>
  );
}
