import { useEffect, useState } from "react";
import { X, Palette, Pencil, Trash2 } from "lucide-react";
import { toast } from "../store/toastStore";
import { useThemeStore } from "../store/themeStore";
import { PRESET_THEMES } from "../lib/themes";
import { usePrOpenPreferenceStore, type PrOpenPreference } from "../store/prOpenPreferenceStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useCiPrefsStore } from "../store/ciPrefsStore";
import ThemeColorEditor, { FIELDS } from "./ThemeColorEditor";
import RepoSettingsSection from "./RepoSettingsSection";
import SearchIndexSection from "./SearchIndexSection";
import { useSettingsModalStore } from "../store/settingsModalStore";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const {
    activeRef,
    activeColors,
    customThemes,
    draft,
    fontSize,
    diffViewTheme,
    selectPreset,
    selectCustom,
    startCustomizing,
    deleteCustomTheme,
    renameCustomTheme,
    setUiFontSize,
    setDiffViewFontSize,
    setDiffViewColor,
  } = useThemeStore();
  const { preference: prOpenPreference, setPreference: setPrOpenPreference } = usePrOpenPreferenceStore();
  const activeRepoPath = useWorkspaceStore((s) => s.repos.find((r) => r.id === s.activeRepoId)?.path);
  const requestedRepoPath = useSettingsModalStore((s) => s.repoPath);
  const badgeFollowsFavorites = useCiPrefsStore((s) => (activeRepoPath ? s.getPrefs(activeRepoPath).badgeFollowsFavorites : true));
  const setBadgeFollowsFavorites = useCiPrefsStore((s) => s.setBadgeFollowsFavorites);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[28rem] max-h-[80vh] overflow-y-auto bg-surface border border-border-subtle rounded-lg shadow-lg p-4 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Theme</h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Presets</div>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_THEMES.map((preset) => {
              const isActive = activeRef.type === "preset" && activeRef.id === preset.id && !draft;
              return (
                <div
                  key={preset.id}
                  role="button"
                  tabIndex={0}
                  className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs cursor-pointer ${
                    isActive ? "border-accent" : "border-border-subtle"
                  }`}
                  onClick={() => selectPreset(preset.id)}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-full border border-border-subtle"
                      style={{ backgroundColor: preset.colors.accent }}
                    />
                    <span className="text-text-primary">{preset.name}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Customize ${preset.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      startCustomizing(preset.id, "preset");
                    }}
                    className="text-text-muted hover:text-text-primary"
                  >
                    <Palette size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {customThemes.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Custom themes</div>
            <div className="flex flex-col gap-1">
              {customThemes.map((custom) => {
                const isActive = activeRef.type === "custom" && activeRef.id === custom.id && !draft;
                return (
                  <div
                    key={custom.id}
                    role="button"
                    tabIndex={0}
                    className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs cursor-pointer ${
                      isActive ? "border-accent" : "border-border-subtle"
                    }`}
                    onClick={() => selectCustom(custom.id)}
                  >
                    {renamingId === custom.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => {
                          if (renameValue.trim()) {
                            renameCustomTheme(custom.id, renameValue.trim());
                            if (renameValue.trim() !== custom.name) toast.success(`Renamed theme to "${renameValue.trim()}"`);
                          }
                          setRenamingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        className="flex-1 bg-elevated border border-border-subtle rounded px-1 text-text-primary"
                      />
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-3 w-3 rounded-full border border-border-subtle"
                          style={{ backgroundColor: custom.colors.accent }}
                        />
                        <span className="text-text-primary">{custom.name}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Rename ${custom.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(custom.id);
                          setRenameValue(custom.name);
                        }}
                        className="text-text-muted hover:text-text-primary"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Customize ${custom.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          startCustomizing(custom.id, "custom");
                        }}
                        className="text-text-muted hover:text-text-primary"
                      >
                        <Palette size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${custom.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCustomTheme(custom.id);
                          toast.info(`Deleted theme "${custom.name}"`);
                        }}
                        className="text-text-muted hover:text-danger"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {draft && (
          <div>
            <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Customize</div>
            <ThemeColorEditor />
          </div>
        )}

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Font size</div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-2 text-xs text-text-primary">
              <span>App UI</span>
              <input
                type="number"
                aria-label="App UI font size"
                min={8}
                max={24}
                value={fontSize.ui}
                onChange={(e) => setUiFontSize(Number(e.target.value))}
                className="w-16 bg-elevated border border-border-subtle rounded px-1.5 py-0.5 text-xs text-text-primary"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-primary">
              <span>Diff view</span>
              <input
                type="number"
                aria-label="Diff view font size"
                min={8}
                max={24}
                value={fontSize.diffView}
                onChange={(e) => setDiffViewFontSize(Number(e.target.value))}
                className="w-16 bg-elevated border border-border-subtle rounded px-1.5 py-0.5 text-xs text-text-primary"
              />
            </label>
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Diff view color overrides</div>
          <div className="flex flex-col gap-2">
            {FIELDS.map(({ key, label }) => {
              const overrideValue = diffViewTheme?.[key];
              return (
                <div key={key} className="flex items-center justify-between gap-2 text-xs text-text-primary">
                  <span>{label}</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label={`${label} override`}
                      value={overrideValue ?? activeColors[key]}
                      onChange={(e) => setDiffViewColor(key, e.target.value)}
                      className="h-6 w-8 rounded border border-border-subtle bg-transparent"
                    />
                    {overrideValue && (
                      <button
                        type="button"
                        aria-label={`Reset ${label} override`}
                        onClick={() => setDiffViewColor(key, null)}
                        className="text-text-muted hover:text-text-primary"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-2">
            Opening a commit&apos;s pull request
          </div>
          <select
            aria-label="Open pull request"
            value={prOpenPreference}
            onChange={(e) => setPrOpenPreference(e.target.value as PrOpenPreference)}
            className="w-full bg-elevated border border-border-subtle rounded px-2 py-1 text-xs text-text-primary"
          >
            <option value="ask">Ask every time</option>
            <option value="app">Always open in app</option>
            <option value="browser">Always open in browser</option>
          </select>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-2">CI</div>
          <label className="flex items-center gap-2 text-xs text-text-primary">
            <input
              type="checkbox"
              aria-label="Badges follow favorite workflows"
              checked={badgeFollowsFavorites}
              disabled={!activeRepoPath}
              onChange={(e) => activeRepoPath && setBadgeFollowsFavorites(activeRepoPath, e.target.checked)}
            />
            <span>Badges follow favorite workflows (when favorites-only is on)</span>
          </label>
        </div>

        <RepoSettingsSection
          initialRepoPath={requestedRepoPath ?? activeRepoPath}
          scrollIntoView={!!requestedRepoPath}
        />

        <SearchIndexSection />
      </div>
    </div>
  );
}
