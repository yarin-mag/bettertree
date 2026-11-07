import { useEffect } from "react";
import { useReleaseNotesStore, selectPicking } from "../store/releaseNotesStore";
import { headEnd } from "../lib/releaseNotes";

export default function ReleaseNotesPickBanner() {
  const picking = useReleaseNotesStore(selectPicking);
  const from = useReleaseNotesStore((s) => s.from);
  const to = useReleaseNotesStore((s) => s.to);
  const clear = useReleaseNotesStore((s) => s.clear);

  useEffect(() => {
    if (!picking) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        clear();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [picking, clear]);

  if (!picking) return null;

  return (
    <div
      data-testid="release-notes-pick-banner"
      className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle bg-accent-soft text-text-primary"
    >
      <span className="truncate flex-1">
        {from ? (
          <>
            Release notes after <b>{from.label}</b> — click the last commit
          </>
        ) : (
          <>
            Release notes up to <b>{to?.label}</b> — click the first commit
          </>
        )}
      </span>
      {from && (
        <button
          type="button"
          className="px-2 py-0.5 rounded border border-border-subtle hover:bg-hover"
          onClick={() => useReleaseNotesStore.getState().markTo(headEnd())}
        >
          Up to HEAD
        </button>
      )}
      <button type="button" className="px-2 py-0.5 rounded border border-border-subtle hover:bg-hover" onClick={clear}>
        Cancel
      </button>
    </div>
  );
}
