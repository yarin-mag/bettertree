# Bettertree `settings.json` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing in-app theme system from `localStorage` into a watched `settings.json` file, and add an app-wide UI font-size setting plus font-size/color overrides scoped to the diff view.

**Architecture:** Rust owns the file (read/write/watch) as an opaque `serde_json::Value` — it never parses the schema, only the frontend does. Two Tauri commands (`get_settings`, `write_settings`) plus a background file watcher (`notify` crate) that emits a `settings-changed` event whenever the file changes on disk (by the app itself or a hand-edit). The existing `themeStore.ts` is extended in place — same public API, persistence swapped from `localStorage` to these commands — and gains `fontSize`/`diffViewTheme` state. Font sizes reuse the exact CSS-custom-property pattern the app already uses for colors (`tailwind.config.js` maps utility classes to `var(--...)`).

**Tech Stack:** Tauri 2, Rust (`serde_json`, `notify` — new dependency), React + Zustand, Tailwind CSS 3, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-bettertree-settings-json.md`

## Global Constraints

- **This project is not git-tracked** (user's explicit prior call — see project memory). Every task below ends with a **Checkpoint** step (run the task's test command, confirm it passes) instead of a `git add`/`git commit` step. Do not run any `git` command in this repo.
- Rust commands follow the existing `commands.rs` pattern: `#[tauri::command] pub async fn name(...) -> Result<T, AppError>`, using `run_blocking(...)` for filesystem work (see `src-tauri/src/commands.rs:17-26`).
- `AppError` (`src-tauri/src/error.rs`) already has an `Io` variant (`#[from] std::io::Error`) and an `Operation(String)` variant — use `Operation` for schema/validation errors, let `?` auto-convert I/O errors.
- Frontend store/component tests in this codebase mock the Tauri boundary by mocking `../lib/tauri` (see `src/__tests__/prDiffStore.test.ts:1-5`) — never mock `@tauri-apps/api/core` directly.
- `dirs = "5"` and `tempfile = "3"` (dev-dependency) are already in `src-tauri/Cargo.toml` — no need to add either.

---

### Task 1: Rust — `settings.rs` module (defaults, read, write)

**Files:**
- Create: `src-tauri/src/settings.rs`
- Modify: `src-tauri/src/lib.rs:1-14` (add `mod settings;` to the module list)

**Interfaces:**
- Produces: `pub fn settings_path(data_dir: &Path) -> PathBuf`, `pub fn default_settings() -> serde_json::Value`, `pub fn read_or_init_settings(path: &Path) -> Result<serde_json::Value, AppError>`, `pub fn write_settings_to_disk(path: &Path, value: &serde_json::Value) -> Result<(), AppError>`. Task 2 (commands) and Task 3 (watcher) both call these by these exact names.

- [ ] **Step 1: Create `src-tauri/src/settings.rs`**

```rust
use crate::error::AppError;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

pub fn default_settings() -> Value {
    json!({
        "theme": {
            "active": { "type": "preset", "id": "github-dark" },
            "customThemes": []
        },
        "fontSize": { "ui": 12, "diffView": 14 },
        "diffViewTheme": null
    })
}

pub fn read_or_init_settings(path: &Path) -> Result<Value, AppError> {
    if !path.exists() {
        let defaults = default_settings();
        write_settings_to_disk(path, &defaults)?;
        return Ok(defaults);
    }
    let raw = std::fs::read_to_string(path)?;
    serde_json::from_str(&raw)
        .map_err(|e| AppError::Operation(format!("invalid settings.json: {e}")))
}

pub fn write_settings_to_disk(path: &Path, value: &Value) -> Result<(), AppError> {
    if !value.is_object() {
        return Err(AppError::Operation("settings must be a JSON object".to_string()));
    }
    let pretty = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Operation(format!("failed to serialize settings: {e}")))?;
    std::fs::write(path, pretty)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn read_or_init_settings_creates_defaults_when_missing() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        assert!(!path.exists());

        let value = read_or_init_settings(&path).unwrap();

        assert!(path.exists());
        assert_eq!(value["fontSize"]["ui"], 12);
        assert_eq!(value["theme"]["active"]["id"], "github-dark");
    }

    #[test]
    fn write_then_read_roundtrips() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        let mut value = default_settings();
        value["fontSize"]["ui"] = json!(16);

        write_settings_to_disk(&path, &value).unwrap();
        let read_back = read_or_init_settings(&path).unwrap();

        assert_eq!(read_back["fontSize"]["ui"], 16);
    }

    #[test]
    fn write_settings_rejects_non_object() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());

        let result = write_settings_to_disk(&path, &json!([1, 2, 3]));

        assert!(result.is_err());
        assert!(!path.exists());
    }

    #[test]
    fn read_or_init_settings_errors_on_malformed_json_without_overwriting() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        std::fs::write(&path, "not json").unwrap();

        let result = read_or_init_settings(&path);

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "not json");
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, add `mod settings;` alongside the other `mod` declarations at the top of the file (after `mod test_support;` on line 14).

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test settings::`
Expected: 4 tests pass (`read_or_init_settings_creates_defaults_when_missing`, `write_then_read_roundtrips`, `write_settings_rejects_non_object`, `read_or_init_settings_errors_on_malformed_json_without_overwriting`).

- [ ] **Step 4: Checkpoint**

No commit (project isn't git-tracked). Confirm Step 3's output shows all 4 tests passing before moving on.

---

### Task 2: Rust — wire `get_settings`/`write_settings` Tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs:19-33` (`AppState` struct + `.manage(...)` call)
- Modify: `src-tauri/src/commands.rs` (add two commands, add `use crate::settings;` to the imports)
- Modify: `src-tauri/src/lib.rs:41-73` (`invoke_handler!` list)

**Interfaces:**
- Consumes: `settings::settings_path`, `settings::read_or_init_settings`, `settings::write_settings_to_disk` (Task 1).
- Produces: Tauri commands `get_settings` and `write_settings`, invoked from the frontend as `invoke("get_settings")` / `invoke("write_settings", { value })` (Task 4 wraps these).

- [ ] **Step 1: Add `data_dir` to `AppState`**

In `src-tauri/src/lib.rs`, change:

```rust
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
}
```

to:

```rust
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub data_dir: std::path::PathBuf,
}
```

and change the `.manage(...)` call inside `run()` from:

```rust
        .manage(AppState { db: Arc::new(Mutex::new(conn)) });
```

to:

```rust
        .manage(AppState { db: Arc::new(Mutex::new(conn)), data_dir: data_dir.clone() });
```

(`data_dir.clone()` because Task 3 needs the original `data_dir` value again for the watcher — using the same local variable, not moving it here, keeps that available.)

- [ ] **Step 2: Add the two commands**

In `src-tauri/src/commands.rs`, add `use crate::settings;` to the `use` block at the top (after `use crate::search::{self, SearchHit};` on line 11), then append at the end of the file:

```rust
#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    let path = settings::settings_path(&state.data_dir);
    run_blocking(move || settings::read_or_init_settings(&path)).await
}

#[tauri::command]
pub async fn write_settings(state: State<'_, AppState>, value: serde_json::Value) -> Result<(), AppError> {
    let path = settings::settings_path(&state.data_dir);
    run_blocking(move || settings::write_settings_to_disk(&path, &value)).await
}
```

- [ ] **Step 3: Register the commands**

In `src-tauri/src/lib.rs`, add `commands::get_settings,` and `commands::write_settings,` to the `tauri::generate_handler![...]` list (anywhere in the list; e.g. right after `commands::compare_refs,`).

- [ ] **Step 4: Verify it builds and existing tests stay green**

Run: `cd src-tauri && cargo test`
Expected: all existing tests plus Task 1's 4 settings tests pass, no compile errors.

- [ ] **Step 5: Checkpoint**

No commit. Confirm Step 4's output is green.

---

### Task 3: Rust — file watcher (`notify`) + `settings-changed` event

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `notify = "6"` under `[dependencies]`)
- Modify: `src-tauri/src/settings.rs` (add `spawn_watcher` + its tests)
- Modify: `src-tauri/src/lib.rs` (wire the watcher into `.setup(...)`)

**Interfaces:**
- Produces: `pub fn spawn_watcher<F: Fn(serde_json::Value) + Send + 'static>(path: PathBuf, on_change: F)`. `lib.rs` calls this with a closure that emits the Tauri event — this keeps the watcher's file-watching logic testable without a running Tauri app.

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:

```toml
notify = "6"
```

Run `cd src-tauri && cargo check` once to confirm it resolves; if `notify = "6"` fails to resolve, run `cargo add notify` instead and use whatever version it picks for the rest of this task.

- [ ] **Step 2: Add `spawn_watcher` to `settings.rs`**

Add near the top of `src-tauri/src/settings.rs`, after the existing `use` lines:

```rust
use notify::{RecursiveMode, Watcher};
use std::sync::mpsc::channel;
```

Then add this function after `write_settings_to_disk`:

```rust
pub fn spawn_watcher<F>(path: PathBuf, on_change: F)
where
    F: Fn(Value) + Send + 'static,
{
    std::thread::spawn(move || {
        let Some(dir) = path.parent().map(|p| p.to_path_buf()) else {
            eprintln!("settings watcher: no parent dir for {path:?}");
            return;
        };
        let (tx, rx) = channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("settings watcher failed to start: {e}");
                return;
            }
        };
        if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
            eprintln!("settings watcher failed to watch {dir:?}");
            return;
        }
        for res in rx {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("settings watcher error: {e}");
                    continue;
                }
            };
            if !event.kind.is_modify() && !event.kind.is_create() {
                continue;
            }
            if !event.paths.iter().any(|p| p == &path) {
                continue;
            }
            match read_or_init_settings(&path) {
                Ok(value) => on_change(value),
                Err(e) => eprintln!("settings.json invalid, ignoring: {e}"),
            }
        }
    });
}
```

- [ ] **Step 3: Add watcher tests**

Add to the `#[cfg(test)] mod tests` block in `settings.rs` (alongside the existing 4 tests):

```rust
    #[test]
    fn spawn_watcher_emits_parsed_value_on_change() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        write_settings_to_disk(&path, &default_settings()).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        spawn_watcher(path.clone(), move |value| {
            let _ = tx.send(value);
        });

        // give the watcher a moment to register before the write it must observe
        std::thread::sleep(std::time::Duration::from_millis(200));
        let mut updated = default_settings();
        updated["fontSize"]["ui"] = json!(20);
        write_settings_to_disk(&path, &updated).unwrap();

        let received = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(received["fontSize"]["ui"], 20);
    }

    #[test]
    fn spawn_watcher_skips_malformed_json_without_emitting() {
        let dir = TempDir::new().unwrap();
        let path = settings_path(dir.path());
        write_settings_to_disk(&path, &default_settings()).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        spawn_watcher(path.clone(), move |value| {
            let _ = tx.send(value);
        });

        std::thread::sleep(std::time::Duration::from_millis(200));
        std::fs::write(&path, "not json").unwrap();

        let result = rx.recv_timeout(std::time::Duration::from_millis(500));
        assert!(result.is_err(), "watcher must not emit for malformed JSON");
    }
```

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test settings::`
Expected: 6 tests pass (Task 1's 4 plus these 2). The watcher tests are timing-sensitive but generous (5s/500ms timeouts) — if `spawn_watcher_emits_parsed_value_on_change` flakes, bump the 200ms setup sleep, not the 5s receive timeout.

- [ ] **Step 5: Wire the watcher into app startup**

In `src-tauri/src/lib.rs`, add `use tauri::Emitter;` to the imports at the top, then change the `run()` function's builder construction from:

```rust
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { db: Arc::new(Mutex::new(conn)), data_dir: data_dir.clone() });
```

to:

```rust
    let settings_path = settings::settings_path(&data_dir);
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { db: Arc::new(Mutex::new(conn)), data_dir: data_dir.clone() })
        .setup(move |app| {
            let handle = app.handle().clone();
            settings::spawn_watcher(settings_path.clone(), move |value| {
                let _ = handle.emit("settings-changed", value);
            });
            Ok(())
        });
```

- [ ] **Step 6: Verify the full build**

Run: `cd src-tauri && cargo build && cargo test`
Expected: builds cleanly, all tests (Task 1 + Task 3, plus pre-existing) pass.

- [ ] **Step 7: Checkpoint**

No commit. Confirm Step 6 is green.

---

### Task 4: Frontend — `lib/themes.ts` exports + `lib/tauri.ts` `Settings` type

**Files:**
- Modify: `src/lib/themes.ts`
- Modify: `src/lib/tauri.ts`
- Test: `src/__tests__/themes.test.ts`

**Interfaces:**
- Produces: `export const CSS_VAR_MAP` (was private), `export type ActiveThemeRef = { type: "preset" | "custom"; id: string }`, `export function applyUiFontSize(px: number): void`, `export function diffViewCssVars(diffFontSizePx: number, overrides: Partial<ThemeColors> | null): Record<string, string>` from `lib/themes.ts`; `export interface Settings { theme: {...}; fontSize: {...}; diffViewTheme: ... }`, `export const invokeGetSettings`, `export const invokeWriteSettings` from `lib/tauri.ts`. Task 5 (`themeStore.ts`) and Task 8 (`DiffViewer.tsx`) both import these by these exact names.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/themes.test.ts`, changing the import line from:

```ts
import { PRESET_THEMES, isDarkColor, hexToRgba, applyTheme } from "../lib/themes";
```

to:

```ts
import { PRESET_THEMES, isDarkColor, hexToRgba, applyTheme, applyUiFontSize, diffViewCssVars } from "../lib/themes";
```

and adding these three `it` blocks inside the existing `describe("themes", ...)` block:

```ts
  it("applyUiFontSize sets the --font-size-xs CSS var", () => {
    applyUiFontSize(16);
    expect(document.documentElement.style.getPropertyValue("--font-size-xs")).toBe("16px");
  });

  it("diffViewCssVars sets only the diff font size var when there are no overrides", () => {
    expect(diffViewCssVars(18, null)).toEqual({ "--font-size-sm": "18px" });
  });

  it("diffViewCssVars maps override color keys to their CSS vars", () => {
    expect(diffViewCssVars(14, { accent: "#ff00ff", canvas: "#000000" })).toEqual({
      "--font-size-sm": "14px",
      "--accent": "#ff00ff",
      "--bg-canvas": "#000000",
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/themes.test.ts`
Expected: FAIL — `applyUiFontSize`/`diffViewCssVars` are not exported yet.

- [ ] **Step 3: Implement in `lib/themes.ts`**

Change the private map declaration:

```ts
const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
```

to:

```ts
export const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
```

Add this type near the top, after the `CustomTheme` type declaration:

```ts
export type ActiveThemeRef = { type: "preset" | "custom"; id: string };
```

Add these two functions after `applyTheme`:

```ts
export function applyUiFontSize(px: number): void {
  document.documentElement.style.setProperty("--font-size-xs", `${px}px`);
}

export function diffViewCssVars(
  diffFontSizePx: number,
  overrides: Partial<ThemeColors> | null
): Record<string, string> {
  const vars: Record<string, string> = { "--font-size-sm": `${diffFontSizePx}px` };
  if (overrides) {
    (Object.keys(overrides) as Array<keyof ThemeColors>).forEach((key) => {
      const value = overrides[key];
      if (value) vars[CSS_VAR_MAP[key]] = value;
    });
  }
  return vars;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/themes.test.ts`
Expected: PASS (9 tests: the original 6 plus these 3).

- [ ] **Step 5: Add the `Settings` type and invoke wrappers to `lib/tauri.ts`**

Add near the top of `src/lib/tauri.ts`, after the `invoke` import:

```ts
import type { ActiveThemeRef, CustomTheme, ThemeColors } from "./themes";

export interface Settings {
  theme: { active: ActiveThemeRef; customThemes: CustomTheme[] };
  fontSize: { ui: number; diffView: number };
  diffViewTheme: Partial<ThemeColors> | null;
}
```

Add near the bottom of the file, with the other `invoke*` exports:

```ts
export const invokeGetSettings = () => invoke<Settings>("get_settings");
export const invokeWriteSettings = (value: Settings) => invoke<void>("write_settings", { value });
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Checkpoint**

No commit. Confirm Steps 4 and 6 are green.

---

### Task 5: Frontend — `themeStore.ts` persists to `settings.json`, adds font size + diff-view overrides

**Files:**
- Modify: `src/store/themeStore.ts` (full rewrite)
- Modify: `src/__tests__/themeStore.test.ts` (full rewrite)
- Modify: `src/__tests__/SettingsModal.test.tsx` (mock `../lib/tauri`)
- Modify: `src/__tests__/ThemeColorEditor.test.tsx` (mock `../lib/tauri`)

**Interfaces:**
- Consumes: `CSS_VAR_MAP` is not needed here; uses `PRESET_THEMES`, `applyTheme`, `applyUiFontSize`, `ActiveThemeRef`, `ThemeColors`, `CustomTheme` from `lib/themes.ts` (Task 4); `Settings`, `invokeWriteSettings` from `lib/tauri.ts` (Task 4).
- Produces: `useThemeStore` gains `fontSize: { ui: number; diffView: number }`, `diffViewTheme: Partial<ThemeColors> | null`, and actions `setUiFontSize(px: number)`, `setDiffViewFontSize(px: number)`, `setDiffViewColor(key: keyof ThemeColors, hex: string | null)`, `applySettings(settings: Settings)`. `reloadThemeFromStorage` is removed (no longer applicable — settings loading is now `applySettings`, exercised directly in tests instead of reading `localStorage`). Task 6 (`SettingsSync`) calls `applySettings`. Task 9 (`SettingsModal`) calls `setUiFontSize`/`setDiffViewFontSize`/`setDiffViewColor` and reads `fontSize`/`diffViewTheme`.

**Why `reloadThemeFromStorage` goes away:** it existed only to let tests simulate "app starts with different stored data" by writing to `localStorage` first. There is no `localStorage` involved anymore — the equivalent simulation is calling `applySettings(...)` directly with the settings object under test, which is both simpler and exactly what `SettingsSync` (Task 6) does in production.

**Why the "corrupt JSON" test disappears:** the store's `applySettings` always receives an already-parsed `Settings` object — the JSON-parsing step now happens in Rust's `read_or_init_settings` (Task 1), which already has a dedicated test (`read_or_init_settings_errors_on_malformed_json_without_overwriting`) for the malformed-JSON case. There's nothing left to test at the store layer for that scenario.

- [ ] **Step 1: Rewrite `src/store/themeStore.ts`**

Replace the entire file with:

```ts
import { create } from "zustand";
import {
  PRESET_THEMES,
  applyTheme,
  applyUiFontSize,
  type ThemeColors,
  type CustomTheme,
  type ActiveThemeRef,
} from "../lib/themes";
import { invokeWriteSettings, type Settings } from "../lib/tauri";

const DEFAULT_PRESET_ID = "github-dark";

type ActiveRef = ActiveThemeRef;

interface FontSizeSettings {
  ui: number;
  diffView: number;
}

interface ThemeState {
  activeRef: ActiveRef;
  activeColors: ThemeColors;
  activeMode: "dark" | "light";
  customThemes: CustomTheme[];
  draft: ThemeColors | null;
  draftSourceId: string | null;
  fontSize: FontSizeSettings;
  diffViewTheme: Partial<ThemeColors> | null;

  selectPreset: (id: string) => void;
  selectCustom: (id: string) => void;
  startCustomizing: (sourceId: string, sourceType: "preset" | "custom") => void;
  updateDraftColor: (key: keyof ThemeColors, hex: string) => void;
  saveDraftAs: (name: string) => void;
  updateExistingCustom: () => void;
  cancelDraft: () => void;
  deleteCustomTheme: (id: string) => void;
  renameCustomTheme: (id: string, name: string) => void;
  setUiFontSize: (px: number) => void;
  setDiffViewFontSize: (px: number) => void;
  setDiffViewColor: (key: keyof ThemeColors, hex: string | null) => void;
  applySettings: (settings: Settings) => void;
}

const DEFAULT_FONT_SIZE: FontSizeSettings = { ui: 12, diffView: 14 };

function defaultColors(): ThemeColors {
  return PRESET_THEMES.find((p) => p.id === DEFAULT_PRESET_ID)!.colors;
}

function resolveValidRef(ref: ActiveRef, customThemes: CustomTheme[]): ActiveRef {
  if (!ref || (ref.type !== "preset" && ref.type !== "custom") || typeof ref.id !== "string") {
    return { type: "preset", id: DEFAULT_PRESET_ID };
  }
  if (ref.type === "custom" && !customThemes.some((c) => c.id === ref.id)) {
    return { type: "preset", id: DEFAULT_PRESET_ID };
  }
  if (ref.type === "preset" && !PRESET_THEMES.some((p) => p.id === ref.id)) {
    return { type: "preset", id: DEFAULT_PRESET_ID };
  }
  return ref;
}

function resolveColors(ref: ActiveRef, customThemes: CustomTheme[]): ThemeColors {
  if (ref.type === "preset") {
    return PRESET_THEMES.find((p) => p.id === ref.id)?.colors ?? defaultColors();
  }
  return customThemes.find((c) => c.id === ref.id)?.colors ?? defaultColors();
}

function buildInitialState() {
  const activeRef: ActiveRef = { type: "preset", id: DEFAULT_PRESET_ID };
  const activeColors = defaultColors();
  const activeMode = applyTheme(activeColors);
  applyUiFontSize(DEFAULT_FONT_SIZE.ui);
  return { activeRef, activeColors, activeMode, customThemes: [] as CustomTheme[], fontSize: DEFAULT_FONT_SIZE };
}

function persist(state: Pick<ThemeState, "activeRef" | "customThemes" | "fontSize" | "diffViewTheme">) {
  const settings: Settings = {
    theme: { active: state.activeRef, customThemes: state.customThemes },
    fontSize: state.fontSize,
    diffViewTheme: state.diffViewTheme,
  };
  invokeWriteSettings(settings).catch((e) => console.warn("failed to persist settings.json", e));
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...buildInitialState(),
  draft: null,
  draftSourceId: null,
  diffViewTheme: null,

  selectPreset: (id) => {
    const preset = PRESET_THEMES.find((p) => p.id === id);
    if (!preset) return;
    const ref: ActiveRef = { type: "preset", id };
    const mode = applyTheme(preset.colors);
    set({ activeRef: ref, activeColors: preset.colors, activeMode: mode, draft: null, draftSourceId: null });
    persist(get());
  },

  selectCustom: (id) => {
    const custom = get().customThemes.find((c) => c.id === id);
    if (!custom) return;
    const ref: ActiveRef = { type: "custom", id };
    const mode = applyTheme(custom.colors);
    set({ activeRef: ref, activeColors: custom.colors, activeMode: mode, draft: null, draftSourceId: null });
    persist(get());
  },

  startCustomizing: (sourceId, sourceType) => {
    const source =
      sourceType === "preset"
        ? PRESET_THEMES.find((p) => p.id === sourceId)
        : get().customThemes.find((c) => c.id === sourceId);
    if (!source) return;
    set({
      draft: { ...source.colors },
      draftSourceId: sourceType === "custom" ? sourceId : null,
    });
  },

  updateDraftColor: (key, hex) => {
    const draft = get().draft;
    if (!draft) return;
    const next = { ...draft, [key]: hex };
    applyTheme(next);
    set({ draft: next });
  },

  saveDraftAs: (name) => {
    const draft = get().draft;
    if (!draft) return;
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const theme: CustomTheme = { id, name, colors: draft };
    const customThemes = [...get().customThemes, theme];
    const ref: ActiveRef = { type: "custom", id };
    const mode = applyTheme(draft);
    set({ customThemes, activeRef: ref, activeColors: draft, activeMode: mode, draft: null, draftSourceId: null });
    persist(get());
  },

  updateExistingCustom: () => {
    const { draft, draftSourceId, customThemes } = get();
    if (!draft || !draftSourceId) return;
    const updated = customThemes.map((c) => (c.id === draftSourceId ? { ...c, colors: draft } : c));
    const ref: ActiveRef = { type: "custom", id: draftSourceId };
    const mode = applyTheme(draft);
    set({ customThemes: updated, activeRef: ref, activeColors: draft, activeMode: mode, draft: null, draftSourceId: null });
    persist(get());
  },

  cancelDraft: () => {
    applyTheme(get().activeColors);
    set({ draft: null, draftSourceId: null });
  },

  deleteCustomTheme: (id) => {
    const { customThemes, activeRef } = get();
    const remaining = customThemes.filter((c) => c.id !== id);
    if (activeRef.type === "custom" && activeRef.id === id) {
      const fallback = defaultColors();
      const ref: ActiveRef = { type: "preset", id: DEFAULT_PRESET_ID };
      const mode = applyTheme(fallback);
      set({ customThemes: remaining, activeRef: ref, activeColors: fallback, activeMode: mode });
    } else {
      set({ customThemes: remaining });
    }
    persist(get());
  },

  renameCustomTheme: (id, name) => {
    const updated = get().customThemes.map((c) => (c.id === id ? { ...c, name } : c));
    set({ customThemes: updated });
    persist(get());
  },

  setUiFontSize: (px) => {
    applyUiFontSize(px);
    set((state) => ({ fontSize: { ...state.fontSize, ui: px } }));
    persist(get());
  },

  setDiffViewFontSize: (px) => {
    set((state) => ({ fontSize: { ...state.fontSize, diffView: px } }));
    persist(get());
  },

  setDiffViewColor: (key, hex) => {
    set((state) => {
      const next = { ...(state.diffViewTheme ?? {}) };
      if (hex) next[key] = hex;
      else delete next[key];
      return { diffViewTheme: Object.keys(next).length > 0 ? next : null };
    });
    persist(get());
  },

  applySettings: (settings) => {
    const activeRef = resolveValidRef(settings.theme.active, settings.theme.customThemes);
    const activeColors = resolveColors(activeRef, settings.theme.customThemes);
    const mode = applyTheme(activeColors);
    applyUiFontSize(settings.fontSize.ui);
    set({
      activeRef,
      customThemes: settings.theme.customThemes,
      activeColors,
      activeMode: mode,
      fontSize: settings.fontSize,
      diffViewTheme: settings.diffViewTheme,
    });
  },
}));
```

- [ ] **Step 2: Rewrite `src/__tests__/themeStore.test.ts`**

Replace the entire file with:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeWriteSettings: vi.fn().mockResolvedValue(undefined),
}));

import { useThemeStore } from "../store/themeStore";
import * as tauriLib from "../lib/tauri";

describe("themeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme-mode");
    useThemeStore.setState({
      customThemes: [],
      draft: null,
      draftSourceId: null,
      fontSize: { ui: 12, diffView: 14 },
      diffViewTheme: null,
    });
    useThemeStore.getState().selectPreset("github-dark");
    vi.clearAllMocks();
  });

  it("selectPreset applies colors, updates state, and persists via write_settings", () => {
    useThemeStore.getState().selectPreset("dracula");
    const state = useThemeStore.getState();
    expect(state.activeRef).toEqual({ type: "preset", id: "dracula" });
    expect(state.activeColors.canvas).toBe("#282a36");
    expect(state.activeMode).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--bg-canvas")).toBe("#282a36");
    expect(tauriLib.invokeWriteSettings).toHaveBeenCalledWith({
      theme: { active: { type: "preset", id: "dracula" }, customThemes: [] },
      fontSize: { ui: 12, diffView: 14 },
      diffViewTheme: null,
    });
  });

  it("selectPreset with GitHub Light resolves activeMode to light", () => {
    useThemeStore.getState().selectPreset("github-light");
    expect(useThemeStore.getState().activeMode).toBe("light");
  });

  it("selectPreset ignores unknown ids", () => {
    const before = useThemeStore.getState().activeRef;
    useThemeStore.getState().selectPreset("does-not-exist");
    expect(useThemeStore.getState().activeRef).toEqual(before);
  });

  it("selectCustom applies a saved custom theme", () => {
    const custom = { id: "c1", name: "Mine", colors: useThemeStore.getState().activeColors };
    useThemeStore.setState({ customThemes: [custom] });
    useThemeStore.getState().selectCustom("c1");
    expect(useThemeStore.getState().activeRef).toEqual({ type: "custom", id: "c1" });
  });

  it("applySettings falls back to github-dark when active references a missing custom theme", () => {
    useThemeStore.getState().applySettings({
      theme: { active: { type: "custom", id: "missing" }, customThemes: [] },
      fontSize: { ui: 12, diffView: 14 },
      diffViewTheme: null,
    });
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
  });

  it("applySettings falls back to github-dark when active references an unknown preset id", () => {
    useThemeStore.getState().applySettings({
      theme: { active: { type: "preset", id: "not-a-real-preset" }, customThemes: [] },
      fontSize: { ui: 12, diffView: 14 },
      diffViewTheme: null,
    });
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
  });

  it("applySettings adopts fontSize and diffViewTheme from the payload", () => {
    useThemeStore.getState().applySettings({
      theme: { active: { type: "preset", id: "nord" }, customThemes: [] },
      fontSize: { ui: 16, diffView: 20 },
      diffViewTheme: { accent: "#ff00ff" },
    });
    const state = useThemeStore.getState();
    expect(state.fontSize).toEqual({ ui: 16, diffView: 20 });
    expect(state.diffViewTheme).toEqual({ accent: "#ff00ff" });
    expect(document.documentElement.style.getPropertyValue("--font-size-xs")).toBe("16px");
  });
});

describe("themeStore draft + custom CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ customThemes: [], fontSize: { ui: 12, diffView: 14 }, diffViewTheme: null });
    useThemeStore.getState().selectPreset("github-dark");
    vi.clearAllMocks();
  });

  it("startCustomizing seeds a draft copy without a source id for a preset", () => {
    useThemeStore.getState().startCustomizing("dracula", "preset");
    const state = useThemeStore.getState();
    expect(state.draft?.canvas).toBe("#282a36");
    expect(state.draftSourceId).toBeNull();
  });

  it("updateDraftColor live-applies the change without persisting activeRef", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().updateDraftColor("accent", "#ff00ff");
    expect(useThemeStore.getState().draft?.accent).toBe("#ff00ff");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#ff00ff");
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
    expect(tauriLib.invokeWriteSettings).not.toHaveBeenCalled();
  });

  it("saveDraftAs creates a new custom theme, persists it, and selects it", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().updateDraftColor("accent", "#ff00ff");
    useThemeStore.getState().saveDraftAs("My Theme");
    const state = useThemeStore.getState();
    expect(state.customThemes).toHaveLength(1);
    expect(state.customThemes[0].name).toBe("My Theme");
    expect(state.customThemes[0].colors.accent).toBe("#ff00ff");
    expect(state.activeRef).toEqual({ type: "custom", id: state.customThemes[0].id });
    expect(state.draft).toBeNull();
    expect(tauriLib.invokeWriteSettings).toHaveBeenCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ customThemes: state.customThemes }) })
    );
  });

  it("startCustomizing on a custom theme sets draftSourceId, and updateExistingCustom overwrites it in place", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("Mine");
    const id = useThemeStore.getState().customThemes[0].id;
    useThemeStore.getState().startCustomizing(id, "custom");
    expect(useThemeStore.getState().draftSourceId).toBe(id);
    useThemeStore.getState().updateDraftColor("danger", "#123456");
    useThemeStore.getState().updateExistingCustom();
    const state = useThemeStore.getState();
    expect(state.customThemes[0].colors.danger).toBe("#123456");
    expect(state.activeRef).toEqual({ type: "custom", id });
  });

  it("deleteCustomTheme falls back to github-dark when deleting the active custom theme", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("Mine");
    const id = useThemeStore.getState().customThemes[0].id;
    useThemeStore.getState().deleteCustomTheme(id);
    expect(useThemeStore.getState().customThemes).toHaveLength(0);
    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "github-dark" });
  });

  it("renameCustomTheme updates the name and persists", () => {
    useThemeStore.getState().startCustomizing("github-dark", "preset");
    useThemeStore.getState().saveDraftAs("Mine");
    const id = useThemeStore.getState().customThemes[0].id;
    useThemeStore.getState().renameCustomTheme(id, "Renamed");
    expect(useThemeStore.getState().customThemes[0].name).toBe("Renamed");
  });
});

describe("themeStore font size + diff view overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ fontSize: { ui: 12, diffView: 14 }, diffViewTheme: null });
  });

  it("setUiFontSize updates state, the CSS var, and persists", () => {
    useThemeStore.getState().setUiFontSize(18);
    expect(useThemeStore.getState().fontSize.ui).toBe(18);
    expect(document.documentElement.style.getPropertyValue("--font-size-xs")).toBe("18px");
    expect(tauriLib.invokeWriteSettings).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: { ui: 18, diffView: 14 } })
    );
  });

  it("setDiffViewFontSize updates only the diffView field", () => {
    useThemeStore.getState().setDiffViewFontSize(22);
    expect(useThemeStore.getState().fontSize).toEqual({ ui: 12, diffView: 22 });
  });

  it("setDiffViewColor sets an override key", () => {
    useThemeStore.getState().setDiffViewColor("accent", "#123123");
    expect(useThemeStore.getState().diffViewTheme).toEqual({ accent: "#123123" });
  });

  it("setDiffViewColor with null clears an override key, resetting to null when it was the last one", () => {
    useThemeStore.getState().setDiffViewColor("accent", "#123123");
    useThemeStore.getState().setDiffViewColor("accent", null);
    expect(useThemeStore.getState().diffViewTheme).toBeNull();
  });
});
```

- [ ] **Step 3: Add the same `../lib/tauri` mock to `SettingsModal.test.tsx` and `ThemeColorEditor.test.tsx`**

`themeStore` actions now call `invokeWriteSettings` under the hood; both files exercise those actions (`selectPreset`, `saveDraftAs`, etc.) without mocking `../lib/tauri`, which would otherwise hit the real (unavailable in tests) Tauri IPC. Add this before the existing imports in **both** `src/__tests__/SettingsModal.test.tsx` and `src/__tests__/ThemeColorEditor.test.tsx`:

```ts
vi.mock("../lib/tauri", () => ({
  invokeWriteSettings: vi.fn().mockResolvedValue(undefined),
}));
```

(`vi` is already imported in both files' existing `import { ... } from "vitest"` line — no new import needed.) Also remove the now-meaningless `localStorage.clear();` lines from both files' `beforeEach` blocks (there's nothing in `localStorage` to clear anymore).

- [ ] **Step 4: Run all affected tests**

Run: `npx vitest run src/__tests__/themeStore.test.ts src/__tests__/SettingsModal.test.tsx src/__tests__/ThemeColorEditor.test.tsx src/__tests__/themes.test.ts`
Expected: all pass.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Checkpoint**

No commit. Confirm Steps 4 and 5 are green.

---

### Task 6: Frontend — `SettingsSync` component (loads settings on startup, subscribes to `settings-changed`)

**Files:**
- Create: `src/components/SettingsSync.tsx`
- Test: `src/__tests__/SettingsSync.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/__tests__/App.test.tsx` (mock the new component, matching the existing pattern for every other child of `App`)

**Interfaces:**
- Consumes: `invokeGetSettings` (Task 4), `useThemeStore().applySettings` (Task 5), `listen` from `@tauri-apps/api/event`.
- Produces: `<SettingsSync />`, a headless (renders `null`) component mounted once by `App.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/SettingsSync.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
vi.mock("../lib/tauri", () => ({
  invokeGetSettings: vi.fn(),
}));

import SettingsSync from "../components/SettingsSync";
import { useThemeStore } from "../store/themeStore";
import * as tauriLib from "../lib/tauri";

const SETTINGS_A = {
  theme: { active: { type: "preset" as const, id: "dracula" }, customThemes: [] },
  fontSize: { ui: 16, diffView: 20 },
  diffViewTheme: null,
};

describe("SettingsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenMock.mockResolvedValue(() => {});
    useThemeStore.getState().selectPreset("github-dark");
  });

  it("applies settings loaded from get_settings on mount", async () => {
    (tauriLib.invokeGetSettings as any).mockResolvedValue(SETTINGS_A);

    render(<SettingsSync />);

    await waitFor(() => expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "dracula" }));
    expect(useThemeStore.getState().fontSize).toEqual({ ui: 16, diffView: 20 });
  });

  it("subscribes to settings-changed and applies incoming payloads", async () => {
    (tauriLib.invokeGetSettings as any).mockResolvedValue(SETTINGS_A);
    let handler: (event: { payload: unknown }) => void = () => {};
    listenMock.mockImplementation((_name: string, cb: (event: { payload: unknown }) => void) => {
      handler = cb;
      return Promise.resolve(() => {});
    });

    render(<SettingsSync />);
    await waitFor(() => expect(listenMock).toHaveBeenCalledWith("settings-changed", expect.any(Function)));

    const pushed = {
      theme: { active: { type: "preset", id: "nord" }, customThemes: [] },
      fontSize: { ui: 14, diffView: 16 },
      diffViewTheme: null,
    };
    handler({ payload: pushed });

    expect(useThemeStore.getState().activeRef).toEqual({ type: "preset", id: "nord" });
    expect(useThemeStore.getState().fontSize).toEqual({ ui: 14, diffView: 16 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/SettingsSync.test.tsx`
Expected: FAIL — `../components/SettingsSync` does not exist yet.

- [ ] **Step 3: Create `src/components/SettingsSync.tsx`**

```tsx
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useThemeStore } from "../store/themeStore";
import { invokeGetSettings, type Settings } from "../lib/tauri";

export default function SettingsSync() {
  const applySettings = useThemeStore((s) => s.applySettings);

  useEffect(() => {
    let cancelled = false;

    invokeGetSettings()
      .then((settings) => {
        if (!cancelled) applySettings(settings);
      })
      .catch((e) => console.warn("failed to load settings.json", e));

    const unlistenPromise = listen<Settings>("settings-changed", (event) => {
      applySettings(event.payload);
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [applySettings]);

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/SettingsSync.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Mount it in `App.tsx`**

In `src/App.tsx`, add the import:

```tsx
import SettingsSync from "./components/SettingsSync";
```

and render it as the first child inside the root `<div>` (before `<Toolbar />`):

```tsx
    <div className="h-screen w-screen flex flex-col bg-canvas text-text-primary">
      <SettingsSync />
      <Toolbar />
```

- [ ] **Step 6: Update `App.test.tsx`**

Add this mock alongside the other `vi.mock("../components/...")` calls at the top of `src/__tests__/App.test.tsx`:

```tsx
vi.mock("../components/SettingsSync", () => ({ default: () => null }));
```

- [ ] **Step 7: Run the full frontend test suite for this task**

Run: `npx vitest run src/__tests__/SettingsSync.test.tsx src/__tests__/App.test.tsx`
Expected: all pass.

- [ ] **Step 8: Checkpoint**

No commit. Confirm Step 7 is green.

---

### Task 7: Frontend — Tailwind font-size CSS vars

**Files:**
- Modify: `tailwind.config.js`

**Interfaces:**
- Produces: the `text-xs`/`text-sm` utility classes now resolve to `var(--font-size-xs, 0.75rem)`/`var(--font-size-sm, 0.875rem)` instead of Tailwind's fixed defaults. Task 8 relies on `--font-size-sm` being overridable per-subtree via inline style.

- [ ] **Step 1: Edit `tailwind.config.js`**

Change:

```js
  theme: {
    extend: {
      colors: {
```

to:

```js
  theme: {
    extend: {
      fontSize: {
        xs: ["var(--font-size-xs, 0.75rem)", { lineHeight: "1rem" }],
        sm: ["var(--font-size-sm, 0.875rem)", { lineHeight: "1.25rem" }],
      },
      colors: {
```

(i.e. add the `fontSize` block as a new sibling of `colors` inside `extend`, leaving `colors` and everything in it unchanged.)

- [ ] **Step 2: Verify Tailwind compiles the var-backed utilities**

Run: `npx tailwindcss -i src/index.css -o /tmp/bettertree-tw-check.css --content "./src/**/*.{ts,tsx}"`
Then: `grep -c "font-size-xs" /tmp/bettertree-tw-check.css`
Expected: a non-zero count (the generated CSS contains `var(--font-size-xs, 0.75rem)` inside the `.text-xs` rule).

- [ ] **Step 3: Run the full vitest suite for a regression check**

Run: `npx vitest run`
Expected: all tests still pass (this change doesn't alter any component behavior visible to jsdom-based tests, since Tailwind's generated CSS isn't loaded in the vitest environment — this step is a safety net, not expected to catch anything here).

- [ ] **Step 4: Checkpoint**

No commit. Confirm Step 2's grep found a match and Step 3 is green.

---

### Task 8: Frontend — `DiffViewer` applies diff-view font size + color overrides

**Files:**
- Modify: `src/components/DiffViewer.tsx`
- Modify: `src/__tests__/DiffViewer.test.tsx`

**Interfaces:**
- Consumes: `diffViewCssVars` (Task 4), `useThemeStore().fontSize.diffView` / `useThemeStore().diffViewTheme` (Task 5).

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/DiffViewer.test.tsx`: change the first import line to also bring in `afterEach`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
```

Add this import below the existing ones:

```tsx
import { useThemeStore } from "../store/themeStore";
```

Add this `afterEach` and test inside `describe("DiffViewer", ...)`:

```tsx
  afterEach(() => {
    useThemeStore.setState({ fontSize: { ui: 12, diffView: 14 }, diffViewTheme: null });
  });

  it("applies the diff-view font size and color overrides as CSS vars on its root", () => {
    useThemeStore.setState({ fontSize: { ui: 12, diffView: 20 }, diffViewTheme: { accent: "#ff00ff" } });
    const { container } = render(<DiffViewer files={files} />);
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--font-size-sm")).toBe("20px");
    expect(root.style.getPropertyValue("--accent")).toBe("#ff00ff");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/DiffViewer.test.tsx`
Expected: FAIL — the root `<div>` has no such inline style yet.

- [ ] **Step 3: Implement in `DiffViewer.tsx`**

Change the import line:

```tsx
import { useThemeStore } from "../store/themeStore";
```

to also import the new helper — the full line becomes:

```tsx
import { useThemeStore } from "../store/themeStore";
import { diffViewCssVars } from "../lib/themes";
```

Inside the component, change:

```tsx
  const theme = useThemeStore((s) => s.activeMode);
```

to:

```tsx
  const theme = useThemeStore((s) => s.activeMode);
  const diffFontSize = useThemeStore((s) => s.fontSize.diffView);
  const diffViewTheme = useThemeStore((s) => s.diffViewTheme);
```

And change the returned root element:

```tsx
  return (
    <div className="flex flex-col gap-2">
```

to:

```tsx
  return (
    <div className="flex flex-col gap-2" style={diffViewCssVars(diffFontSize, diffViewTheme) as React.CSSProperties}>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/DiffViewer.test.tsx`
Expected: PASS (all 4 tests, including the 3 pre-existing ones).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Checkpoint**

No commit. Confirm Steps 4 and 5 are green.

---

### Task 9: Frontend — `SettingsModal` font-size + diff-view color override UI

**Files:**
- Modify: `src/components/ThemeColorEditor.tsx` (export the shared `FIELDS` list)
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/__tests__/SettingsModal.test.tsx`

**Interfaces:**
- Consumes: `FIELDS` exported from `ThemeColorEditor.tsx`; `fontSize`, `diffViewTheme`, `activeColors`, `setUiFontSize`, `setDiffViewFontSize`, `setDiffViewColor` from `useThemeStore()` (Task 5).

- [ ] **Step 1: Export `FIELDS` from `ThemeColorEditor.tsx`**

In `src/components/ThemeColorEditor.tsx`, change:

```tsx
const FIELDS: Array<{ key: keyof ThemeColors; label: string }> = [
```

to:

```tsx
export const FIELDS: Array<{ key: keyof ThemeColors; label: string }> = [
```

- [ ] **Step 2: Write the failing tests**

Add to `src/__tests__/SettingsModal.test.tsx`, inside the existing `describe("SettingsModal", ...)` block:

```tsx
  it("shows current font size values and updates them", () => {
    render(<SettingsModal onClose={() => {}} />);
    const uiInput = screen.getByLabelText("App UI font size") as HTMLInputElement;
    expect(uiInput.value).toBe("12");
    fireEvent.change(uiInput, { target: { value: "18" } });
    expect(useThemeStore.getState().fontSize.ui).toBe(18);
  });

  it("lets you set and reset a diff-view color override", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Accent override"), { target: { value: "#123123" } });
    expect(useThemeStore.getState().diffViewTheme).toEqual({ accent: "#123123" });
    fireEvent.click(screen.getByRole("button", { name: "Reset Accent override" }));
    expect(useThemeStore.getState().diffViewTheme).toBeNull();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/SettingsModal.test.tsx`
Expected: FAIL — no such labeled inputs/buttons exist yet.

- [ ] **Step 4: Implement in `SettingsModal.tsx`**

Change the imports at the top from:

```tsx
import { useEffect, useState } from "react";
import { X, Palette, Pencil, Trash2 } from "lucide-react";
import { useThemeStore } from "../store/themeStore";
import { PRESET_THEMES } from "../lib/themes";
import ThemeColorEditor from "./ThemeColorEditor";
```

to:

```tsx
import { useEffect, useState } from "react";
import { X, Palette, Pencil, Trash2 } from "lucide-react";
import { useThemeStore } from "../store/themeStore";
import { PRESET_THEMES } from "../lib/themes";
import ThemeColorEditor, { FIELDS } from "./ThemeColorEditor";
```

Change the destructured store values from:

```tsx
  const {
    activeRef,
    customThemes,
    draft,
    selectPreset,
    selectCustom,
    startCustomizing,
    deleteCustomTheme,
    renameCustomTheme,
  } = useThemeStore();
```

to:

```tsx
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
```

Add these two new sections right before the closing `{draft && (...)}` block's containing `</div>` — i.e. immediately after the `{draft && ( ... )}` block, still inside the modal's inner `<div>`:

```tsx
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
```

(These two new `<div>` blocks are siblings of the existing "Presets", "Custom themes", and `{draft && (...)}` blocks — add them right after the `{draft && ( ... )}` block, still before the component's final closing `</div></div>`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/SettingsModal.test.tsx`
Expected: PASS (all 9 tests: the original 7 plus these 2).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Checkpoint**

No commit. Confirm Steps 5 and 6 are green.

---

### Task 10: Full regression pass

**Files:** none (verification only).

- [ ] **Step 1: Rust**

Run: `cd src-tauri && cargo test`
Expected: all tests pass, including the 6 new ones from Tasks 1 and 3.

- [ ] **Step 2: TypeScript**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Vitest**

Run: `npx vitest run`
Expected: all tests pass. (The one pre-existing unrelated failure in `Toolbar.test.tsx` noted earlier this session, if still present, is out of scope for this plan — confirm it's the *only* failure, if any.)

- [ ] **Step 4: Manual smoke test**

Run: `npm run tauri dev`. Open Settings, confirm the new "Font size" and "Diff view color overrides" sections appear and change the diff view live. Open a commit's diff, confirm it renders at the configured size/colors. Quit the app, hand-edit `~/Library/Application Support/bettertree/settings.json` (or the platform equivalent — check what `dirs::data_dir()` resolves to on the current OS), change `fontSize.diffView`, save, and confirm the running app updates without a restart.

- [ ] **Step 5: Checkpoint**

No commit. This plan's work is complete once Steps 1-4 are all green/confirmed.
