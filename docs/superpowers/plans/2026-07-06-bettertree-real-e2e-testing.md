# Bettertree Real Native-Window E2E Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one real, native-window end-to-end test that drives the actual compiled Tauri binary (real Rust↔JSON IPC, real SQLite, real git2) — not the mocked Playwright suite — to catch the class of bug the mocked suite structurally cannot (e.g., the snake_case/camelCase serialization bug found earlier in this project, which only a real IPC round-trip would surface).

**Architecture:** `tauri-plugin-wdio-webdriver` (Rust, gated behind an opt-in `e2e-testing` Cargo feature) embeds a W3C WebDriver server inside the app binary; `@wdio/tauri-service` (WebdriverIO) auto-detects it on macOS and drives the real window — no external driver binary needed (unlike Linux/Windows, and unlike the plain `tauri-driver` tool, which has no macOS support at all). Since the real app's "Add repo" flow uses a native OS file-picker dialog that WebDriver cannot click (it's outside the webview), the test seeds the app's real SQLite workspace registry directly and points it at a real temporary git repo, sidestepping the dialog while still exercising every real IPC path after that point.

**Correction made during implementation:** the original design of this plan gated the dependency with `[target.'cfg(debug_assertions)'.dependencies]`, assuming that would exclude it from release builds. Verified empirically that it does not — Cargo's `[target.'cfg(...)']` tables only resolve target-triple cfgs (`target_os`, `unix`, `windows`, etc.), not the `debug_assertions` profile flag, so the crate was still compiled and linked into `cargo build --release` output (confirmed via `target/release/deps/libtauri_plugin_wdio_webdriver*`). Fixed by making it a proper optional dependency behind a Cargo feature (`e2e-testing`) instead — features genuinely exclude a dependency from compilation unless explicitly enabled, which a target-cfg table does not.

**Tech Stack:** `tauri-plugin-wdio-webdriver` (Rust crate, v1.x), `@wdio/tauri-service` + `webdriverio` + `@wdio/cli` + `@wdio/mocha-framework` + `@wdio/spec-reporter` + `mocha` (all v9.x, matching `@wdio/tauri-service`'s own dependency versions).

## Global Constraints

- **The WebDriver plugin must never compile into a release build.** It's an optional dependency behind the `e2e-testing` Cargo feature (`Cargo.toml`), only registered in `lib.rs` when that feature is enabled — a WebDriver automation server embedded in a shipped app is a real attack-surface concern. A plain `cargo build` / `cargo build --release` (no `--features e2e-testing`) must not link the crate at all.
- No git version control for the `bettertree` project itself — no commits. (The test fixture in Task 3 creates its own throwaway git repo *elsewhere* on disk purely as test data; that's unrelated to this constraint.)
- This new suite is **additive** — the existing Playwright suite (`npm run e2e`, 3 specs) and Rust/Vitest suites are untouched and must keep passing.
- macOS-only in this plan (matches the project's current dev machine). Cross-platform WebDriver config (Windows'/Linux's different driver requirements) is out of scope.
- **Expect empirical corrections during execution.** This integration (a real native WebDriver server talking to a real macOS WKWebView) has more moving parts than anything else built in this project so far, and its exact config surface was reconstructed from documentation, not verified against a working local example. Treat config field names, selector syntax, and timing values as best-effort starting points — Task 3's verification step is where reality gets checked, same as every other task in this project's history that needed a live-run correction.

---

## File Structure

```
bettertree/
  src-tauri/
    Cargo.toml                    # MODIFY: optional tauri-plugin-wdio-webdriver behind e2e-testing feature
    src/lib.rs                      # MODIFY: register the plugin only when e2e-testing is enabled
  package.json                        # MODIFY: add WebdriverIO devDependencies + test:tauri script
  wdio.conf.ts                          # NEW: WebdriverIO config, points at the --features e2e-testing binary
  wdio-e2e/
    fixture.ts                            # NEW: creates a real temp git repo + seeds workspace.db
    real-smoke.spec.ts                      # NEW: the one real native-window smoke test
```

`fixture.ts` is the only file that touches the filesystem/SQLite directly — it owns "how do we get real data in front of the real app" so `real-smoke.spec.ts` stays a pure WebdriverIO test (find element, assert).

---

### Task 1: Feature-gated Rust WebDriver plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- (`src-tauri/capabilities/default.json` was considered, but Step 3 explains why it's left unchanged)

**Interfaces:**
- Consumes: nothing.
- Produces: a `bettertree` binary built with `cargo build --features e2e-testing` that embeds a WebDriver server (verified by the plugin appearing in that build's dependency tree, and being fully absent — not just unregistered, but not even compiled — from a plain `cargo build` / `cargo build --release`). Task 2's `wdio.conf.ts` points at the `--features e2e-testing` build's binary path (still `src-tauri/target/debug/bettertree` — features don't change the output path, only what's compiled in).

No unit test — this is a build-configuration change. Verified by inspecting `cargo tree` output with and without the feature enabled, which is the only way to confirm the feature gate actually worked.

- [ ] **Step 1: Add the optional dependency and feature**

Modify `src-tauri/Cargo.toml` — add `tauri-plugin-wdio-webdriver` as an optional dependency in the existing `[dependencies]` block, and declare the `e2e-testing` feature that enables it:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
rusqlite = { version = "0.31", features = ["bundled"] }
git2 = "0.19"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
dirs = "5"
tauri-plugin-wdio-webdriver = { version = "1", optional = true }

[features]
e2e-testing = ["dep:tauri-plugin-wdio-webdriver"]
```

- [ ] **Step 2: Conditionally register the plugin**

Modify `src-tauri/src/lib.rs` — the current `run()` function builds the app in one fluent chain; split it so the plugin can be conditionally attached:

```rust
mod error;
mod db;
mod repo;
mod graph;
mod search;
mod workdir;
mod diff;
mod remote;
mod commands;
mod test_support;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = dirs::data_dir().unwrap().join("bettertree");
    std::fs::create_dir_all(&data_dir).ok();
    let conn = Connection::open(data_dir.join("workspace.db")).expect("failed to open workspace db");
    db::init_db(&conn).expect("failed to init db schema");

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { db: Mutex::new(conn) });

    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            commands::list_repos,
            commands::add_repo,
            commands::remove_repo,
            commands::get_branches,
            commands::get_tags,
            commands::get_commit_graph,
            commands::ensure_search_index,
            commands::search_commits,
            commands::get_status,
            commands::stage_file,
            commands::unstage_file,
            commands::commit_changes,
            commands::get_commit_diff,
            commands::fetch_remote,
            commands::pull_remote,
            commands::push_remote,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bettertree");
}
```

- [ ] **Step 3: Do not add a capability permission for this plugin**

The plugin needs no entry in `src-tauri/capabilities/default.json`. Verified empirically: adding `"wdio-webdriver:default"` there breaks a *plain* `cargo build` outright — Tauri validates every capability's permissions against whichever plugins are actually compiled in for that specific build, and since `tauri-plugin-wdio-webdriver` is correctly absent without the `e2e-testing` feature, the reference fails with `Permission wdio-webdriver:default not found`. There's no static-JSON way to make a capability file conditional on a Cargo feature, and it turns out none is needed — this plugin is driven externally over the WebDriver protocol, not invoked from the app's own frontend JS via `invoke()`, which is what the capability/permission system exists to gate. Leave `capabilities/default.json` exactly as it was before this plan (`["core:default", "dialog:default"]`).

- [ ] **Step 4: Verify the feature gate actually excludes the plugin**

Run: `cd src-tauri && cargo build`
Expected: builds successfully (plain debug build, no feature flag).

Run: `cargo tree | grep wdio`
Expected: no output — without `--features e2e-testing`, the crate is not part of the dependency graph at all.

Run: `find target/debug -iname "*wdio*"`
Expected: no output — confirms the crate wasn't even compiled, not just unregistered (this is the check that caught the earlier `cfg(debug_assertions)` approach silently failing).

Run: `cargo build --features e2e-testing`
Expected: builds successfully, produces `src-tauri/target/debug/bettertree` with the plugin embedded.

Run: `cargo tree --features e2e-testing | grep wdio`
Expected: `tauri-plugin-wdio-webdriver` appears in the dependency tree.

Run: `cargo build --release`
Expected: builds successfully (no feature flag — this is what a real release build looks like).

Run: `find target/release -iname "*wdio*"`
Expected: no output — confirms the plugin is genuinely absent from a release build.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 2: WebdriverIO + @wdio/tauri-service setup

**Files:**
- Modify: `package.json`
- Create: `wdio.conf.ts`

**Interfaces:**
- Consumes: the `e2e-testing` Cargo feature (Task 1) — this task's verification step rebuilds with it explicitly rather than relying on whichever build Task 1 last left behind.
- Produces: a working `npx wdio` CLI installation and config. Task 3's spec file runs under this config via `npm run test:tauri`.

No test in this task — it's tooling installation, verified by the WebdriverIO CLI loading the config without error (no spec files exist yet, so no test run is possible until Task 3).

- [ ] **Step 1: Add the WebdriverIO devDependencies and script**

Modify `package.json` — add to `devDependencies` and `scripts`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "e2e": "playwright test",
    "test:tauri": "wdio run wdio.conf.ts",
    "tauri": "tauri"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.0",
    "@tauri-apps/cli": "^2",
    "@testing-library/dom": "^10",
    "@testing-library/jest-dom": "^6",
    "@testing-library/react": "^16",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4",
    "@wdio/cli": "^9",
    "@wdio/local-runner": "^9",
    "@wdio/mocha-framework": "^9",
    "@wdio/spec-reporter": "^9",
    "@wdio/tauri-service": "^1.2.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^25",
    "mocha": "^10",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  },
  "overrides": {
    "@wdio/native-utils": "2.5.0"
  }
}
```

**Correction found while running Task 3:** `@wdio/tauri-service@1.2.0` exact-pins `@wdio/native-utils@2.4.0`, but that exact published version doesn't export `installMockSyncOverride`, which `@wdio/tauri-service`'s own code imports — a broken upstream release, not a config mistake on our end (verified: `2.5.0` does have the export). The `overrides` field forces npm to substitute `2.5.0` everywhere `@wdio/native-utils` is requested, working around the broken pin without patching `node_modules` by hand.

(only `scripts` and `devDependencies` change — `dependencies` stays as-is from the visual design plan)

- [ ] **Step 2: Write the fixture helpers**

**Correction found while running Task 3, folded back into this task:** the original plan put fixture creation in the spec file's `before()` hook (Task 3). That races the app's own startup — `@wdio/tauri-service` launches the app as part of session/worker startup, which happens *before* any mocha hook in the spec file runs, so a `before()`-seeded repo is written after the app already loaded its (empty) repo list. Fixture creation must happen in `wdio.conf.ts`'s `onPrepare` hook instead, which runs before any session starts — so `fixture.ts` is created here, in Task 2, since `wdio.conf.ts` now imports it.

`wdio-e2e/fixture.ts`:

```typescript
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

export function createFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bettertree-real-e2e-"));
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "one");
  execSync("git add a.txt", { cwd: dir });
  execSync('git commit -m "first commit"', { cwd: dir });
  return dir;
}

export function seedWorkspaceDb(repoPath: string, repoName: string) {
  const appDataDir = join(homedir(), "Library", "Application Support", "bettertree");
  mkdirSync(appDataDir, { recursive: true });
  const dbPath = join(appDataDir, "workspace.db");
  const sql = `
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0
    );
    DELETE FROM repos;
    INSERT INTO repos (path, name, pinned) VALUES ('${repoPath}', '${repoName}', 0);
  `;
  execSync(`sqlite3 "${dbPath}" "${sql.replace(/\n/g, " ")}"`);
}
```

(uses the system `sqlite3` CLI, pre-installed on macOS, purely as test scaffolding — this mirrors the exact schema `db.rs::init_db` creates, so the running app reads it correctly on startup)

- [ ] **Step 3: Create the WebdriverIO config**

`wdio.conf.ts`:

```typescript
import { createFixtureRepo, seedWorkspaceDb } from "./wdio-e2e/fixture";

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./wdio-e2e/**/*.spec.ts"],
  maxInstances: 1,
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: "./src-tauri/target/debug/bettertree",
        autoInstallTauriDriver: true,
      },
    ],
  ],
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: "./src-tauri/target/debug/bettertree",
      },
    },
  ],
  logLevel: "info",
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },
  reporters: ["spec"],
  // Must seed the fixture here, not in a spec's before() hook — the
  // service launches the app as part of session/worker startup, which
  // happens before any mocha hook in the spec file runs. Seeding in a
  // spec-level before() races the app's own startup data load and loses.
  onPrepare: async () => {
    const repoPath = createFixtureRepo();
    seedWorkspaceDb(repoPath, "real-fixture-repo");
  },
};
```

- [ ] **Step 4: Install and sanity-check the CLI**

Run: `npm install`
Expected: installs without error.

Run: `npx wdio config --help`
Expected: prints WebdriverIO CLI help text — confirms the CLI and its plugins resolved correctly. (No test run yet — `specs` glob matches nothing until Task 3.)

Run: `cd src-tauri && cargo build --features e2e-testing && cd ..`
Expected: rebuilds `src-tauri/target/debug/bettertree` with the WebDriver plugin embedded — this is the binary `wdio.conf.ts` points at, built explicitly here rather than assuming Task 1's last build state.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 3: Real smoke test

**Files:**
- Create: `wdio-e2e/real-smoke.spec.ts`

**Interfaces:**
- Consumes: `wdio.conf.ts` and `wdio-e2e/fixture.ts` (Task 2, which seeds the fixture repo via `onPrepare` before this spec ever runs), the `--features e2e-testing` binary built in Task 2's verification step.
- Produces: nothing further — last task in this plan.

- [ ] **Step 1: Write the smoke test**

`wdio-e2e/real-smoke.spec.ts` — no `before()` hook needed; `wdio.conf.ts`'s `onPrepare` (Task 2) already seeded the fixture before this spec's session even started:

```typescript
describe("real app smoke test", () => {
  it("loads the seeded repo and shows its real branch and commit via actual Rust<->JSON IPC", async () => {
    const repoButton = await $("button=real-fixture-repo");
    await repoButton.click();

    const branchLabel = await $("span=main");
    await expect(branchLabel).toBeDisplayed();

    const commitRow = await $('[data-testid="commit-row"]');
    await expect(commitRow).toBeDisplayed();
    await expect(commitRow).toHaveText("first commit", { containing: true });
  });
});
```

This is the test that would prove it: the real compiled binary reads real SQLite data, walks a real git repo via git2, serializes real `BranchInfo`/`GraphCommit` structs to real JSON, and the real React app renders them — the exact path where the camelCase serialization bug lived undetected through three plans of mocked-only e2e coverage.

**Correction found while running this test:** the bare `=text` selector maps to WebDriver's legacy "link text" strategy, which only matches `<a>` elements — it silently returns zero results against our `<button>`s and `<span>`s. Fixed by tag-qualifying the selector (`button=text`, `span=text`), which WebdriverIO matches against that specific element type's own text content. This fix was necessary but not sufficient — see Step 2.

- [ ] **Step 2: Run it for real — blocked on an apparent upstream issue**

Run: `npm run test:tauri`
Expected (per plan): the real Bettertree window launches, and the test passes.

**What actually happened:** the session connects successfully — `getWindowHandle()` resolves to `"main"`, `getWindowHandles()` lists `['main']`, and the plugin's own `window.wdioTauri.waitForInit()` handshake completes. But `document.body.innerHTML` evaluated in that session is empty, and `typeof window.__TAURI__` is `"undefined"` — the automated session isn't seeing the app's real webview content at all. This was true both with a debug binary (initially suspected to be a `devUrl`-vs-bundled-`dist` mismatch, since the debug binary expects a live Vite dev server at `http://localhost:5173` which wasn't running) *and* with a `cargo build --release --features e2e-testing` binary built against `npm run build`'s bundled `dist/` (ruling out the dev-server theory). Launching the same release binary standalone (outside WebdriverIO) opens a real, correctly-titled window with real content — confirmed via `ps aux` and AppleScript window enumeration — so the app itself is not the problem.

This points to `tauri-plugin-wdio-webdriver` / `@wdio/tauri-service` attaching its automation session to a webview that isn't the app's real visible one on macOS — plausible given this tooling is only months old and exists specifically to fill a gap Apple doesn't officially support (no WKWebView WebDriver). Resolving it further would mean reading the plugin's own source or filing an upstream issue, which is out of scope for this plan. **Decision (discussed with the user): stop here.** `wdio-e2e/real-smoke.spec.ts` keeps the intended test, `it.skip`-ed with a comment explaining the blocker, so the code documents what should be tested once upstream is fixed, without failing every `npm run test:tauri` run.

- [ ] **Step 3: Confirm the existing suites are unaffected**

Run: `npm test`
Expected: unchanged — still all Vitest suites passing (no interaction between this new suite and the existing ones).

Run: `npm run e2e`
Expected: unchanged — still all 3 Playwright specs passing.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: unchanged — this plan added no application logic, only a feature-gated plugin registration; all existing Rust tests still pass.

Run: `npm run test:tauri`
Expected: `1 skipped` — the harness runs cleanly (app launches, session connects, no crash), it just doesn't assert anything yet.

- [ ] **Step 4: Mark task complete**

No commit (see Global Constraints). Update the progress ledger — the WebdriverIO harness, feature-gated plugin, and fixture-seeding infrastructure are all in place and verified working; the one real content assertion is blocked on an apparent upstream tool issue and left as a documented, skipped test.

---

## Definition of Done

- The WebDriver plugin is verifiably absent from release builds — not registered, and not even compiled in (`find target/release -iname "*wdio*"` check in Task 1) — and present when `--features e2e-testing` is passed.
- `npm run test:tauri` launches the real compiled Bettertree app, connects a real WebDriver session against it, and seeds a real git repo + SQLite row via `onPrepare` before the app starts — the full harness works end to end.
- **Not achieved, documented instead:** an actual passing content assertion against the real webview. Blocked on what looks like an upstream gap in `tauri-plugin-wdio-webdriver`/`@wdio/tauri-service`'s macOS webview attachment, not fixable from this project's side without further upstream investigation. The intended test is written and skipped with a full explanation in `wdio-e2e/real-smoke.spec.ts`.
- `npm test`, `npm run e2e`, and `cargo test` are all unaffected and still pass.
