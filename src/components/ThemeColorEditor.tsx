import { useState } from "react";
import { useThemeStore } from "../store/themeStore";
import type { ThemeColors } from "../lib/themes";

export const FIELDS: Array<{ key: keyof ThemeColors; label: string }> = [
  { key: "canvas", label: "Canvas background" },
  { key: "surface", label: "Surface background" },
  { key: "elevated", label: "Elevated background" },
  { key: "hover", label: "Hover background" },
  { key: "borderSubtle", label: "Border" },
  { key: "textPrimary", label: "Primary text" },
  { key: "textMuted", label: "Muted text" },
  { key: "accent", label: "Accent" },
  { key: "accentContrast", label: "Accent contrast text" },
  { key: "success", label: "Success" },
  { key: "danger", label: "Danger" },
  { key: "merged", label: "Merged" },
];

export default function ThemeColorEditor() {
  const { draft, draftSourceId, updateDraftColor, saveDraftAs, updateExistingCustom, cancelDraft } = useThemeStore();
  const [newName, setNewName] = useState("");

  if (!draft) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {FIELDS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-2 text-xs text-text-primary">
            <span>{label}</span>
            <span className="flex items-center gap-2">
              <input
                type="color"
                aria-label={label}
                value={draft[key]}
                onChange={(e) => updateDraftColor(key, e.target.value)}
                className="h-6 w-8 rounded border border-border-subtle bg-transparent"
              />
              <input
                type="text"
                aria-label={`${label} hex value`}
                value={draft[key]}
                onChange={(e) => updateDraftColor(key, e.target.value)}
                className="w-20 bg-elevated border border-border-subtle rounded px-1.5 py-0.5 text-xs text-text-primary"
              />
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
        {draftSourceId ? (
          <button
            type="button"
            className="text-xs px-2 py-1 rounded bg-accent text-accent-contrast"
            onClick={updateExistingCustom}
          >
            Update
          </button>
        ) : (
          <>
            <input
              type="text"
              placeholder="Theme name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 bg-elevated border border-border-subtle rounded px-2 py-1 text-xs text-text-primary"
            />
            <button
              type="button"
              className="text-xs px-2 py-1 rounded bg-accent text-accent-contrast disabled:opacity-50"
              disabled={!newName.trim()}
              onClick={() => saveDraftAs(newName.trim())}
            >
              Save as new
            </button>
          </>
        )}
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-border-subtle text-text-primary"
          onClick={cancelDraft}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
