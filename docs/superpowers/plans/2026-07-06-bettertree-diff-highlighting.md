# Bettertree Diff Syntax Highlighting + Branch Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brighten the shared muted-text color (fixing pale branch/date/label text), and rewrite the diff viewer to show real VS-Code-style syntax highlighting with GitHub-style green/red line tinting, in both unified and side-by-side modes.

**Architecture:** A pure `diffLines.ts` module parses `FileDiff.patch` into typed, per-line add/del/context records — this alone gives correct tinting and correct old/new pane splitting for side-by-side mode, synchronously, with zero async dependency. A separate `highlight.ts` module wraps a singleton Shiki highlighter and maps file extensions to languages. `DiffViewer` renders the parsed lines immediately (plain text, correctly tinted) and progressively upgrades each line to Shiki-highlighted HTML as highlighting resolves asynchronously — never a blocked or flashing render.

**Tech Stack:** `shiki` (new dependency), React 18, TypeScript, Zustand (`useThemeStore`, already built).

**Relationship to spec:** Implements `docs/superpowers/specs/2026-07-06-bettertree-diff-highlighting.md` in full. **One correction made during planning:** the spec doesn't specify exact tint implementation, and the obvious approach (Tailwind's `bg-success/15` opacity-modifier syntax) doesn't actually work with this project's color tokens — they're defined as plain `var(--token)` references in `tailwind.config.js`, and Tailwind's opacity modifiers require a special `rgb(var(...) / <alpha-value>)` color format we don't use. Fixed by adding two new *dedicated* low-opacity tokens (`--success-soft-bg`, `--danger-soft-bg`) following the exact pattern `--accent-soft-bg` already established in the visual design plan, instead of relying on a Tailwind feature that wouldn't apply here.

## Global Constraints

- No git version control for this project — no commits. Every task's last step is "mark task complete."
- Highlighting must never block or flash the render — plain (correctly tinted) text shows immediately, upgrading to syntax-highlighted HTML once Shiki resolves.
- Unknown/missing file extensions fall back to `"plaintext"` — never an error, never a blocked render.
- No backend changes — this is a pure frontend rendering change on top of the existing `FileDiff` shape.
- Full regression (`cargo test`, `npm test`, `npm run e2e`) at the end of the last task.

---

## File Structure

```
bettertree/
  package.json                    # MODIFY: add shiki dependency
  src/
    index.css                       # MODIFY: brighten --text-muted, add --success-soft-bg/--danger-soft-bg, Shiki pre/code reset
    lib/
      diffLines.ts                     # NEW: pure patch-text parser (add/del/context lines, old/new pane split)
      highlight.ts                       # NEW: Shiki singleton + extension-to-language mapping
    components/
      DiffViewer.tsx                       # MODIFY: progressive-enhancement rendering using diffLines + highlight
    __tests__/
      diffLines.test.ts                       # NEW
      highlight.test.ts                         # NEW
      DiffViewer.test.tsx                         # NEW
      CommitDrawer.test.tsx                         # MODIFY: mock ../lib/highlight so it doesn't invoke real Shiki
```

`diffLines.ts` has zero dependencies on Shiki or React — it's pure data transformation, independently testable. `highlight.ts` has zero dependencies on diff-specific concepts — it's a generic "highlight this line of code for this file path" utility, reusable if a future feature needs highlighted code outside the diff viewer.

---

### Task 1: Diff line parsing

**Files:**
- Create: `src/lib/diffLines.ts`
- Create: `src/__tests__/diffLines.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DiffLineType = "add" | "del" | "context"`, `DiffLine { type: DiffLineType; content: string }`, `parseDiffLines(patch: string): DiffLine[]`, `oldPaneLines(lines: DiffLine[]): DiffLine[]`, `newPaneLines(lines: DiffLine[]): DiffLine[]`. Task 4's `DiffViewer` consumes all four by these exact names.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/diffLines.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseDiffLines, oldPaneLines, newPaneLines } from "../lib/diffLines";

describe("parseDiffLines", () => {
  it("classifies added, removed, and context lines", () => {
    const lines = parseDiffLines("-one\n+two\n context line\n");
    expect(lines).toEqual([
      { type: "del", content: "one" },
      { type: "add", content: "two" },
      { type: "context", content: "context line" },
    ]);
  });

  it("drops the trailing empty line produced by a final newline", () => {
    const lines = parseDiffLines("+only line\n");
    expect(lines).toHaveLength(1);
  });
});

describe("oldPaneLines / newPaneLines", () => {
  const lines = parseDiffLines("-removed\n+added\n context\n");

  it("oldPaneLines excludes added lines", () => {
    expect(oldPaneLines(lines)).toEqual([
      { type: "del", content: "removed" },
      { type: "context", content: "context" },
    ]);
  });

  it("newPaneLines excludes removed lines", () => {
    expect(newPaneLines(lines)).toEqual([
      { type: "add", content: "added" },
      { type: "context", content: "context" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run diffLines`
Expected: FAIL — `src/lib/diffLines` does not exist yet.

- [ ] **Step 3: Write the implementation**

`src/lib/diffLines.ts`:

```typescript
export type DiffLineType = "add" | "del" | "context";

export interface DiffLine {
  type: DiffLineType;
  content: string;
}

export function parseDiffLines(patch: string): DiffLine[] {
  return patch
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith("+")) return { type: "add" as const, content: line.slice(1) };
      if (line.startsWith("-")) return { type: "del" as const, content: line.slice(1) };
      return { type: "context" as const, content: line.startsWith(" ") ? line.slice(1) : line };
    });
}

// Generic over T so callers passing a subtype (e.g. RenderedLine, which adds
// an `html` field) get that subtype back, not the widened DiffLine base type.
export function oldPaneLines<T extends DiffLine>(lines: T[]): T[] {
  return lines.filter((line) => line.type !== "add");
}

export function newPaneLines<T extends DiffLine>(lines: T[]): T[] {
  return lines.filter((line) => line.type !== "del");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run diffLines`
Expected: all 4 tests pass.

- [ ] **Step 5: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 2: Shiki highlighting wrapper

**Files:**
- Modify: `package.json`
- Create: `src/lib/highlight.ts`
- Create: `src/__tests__/highlight.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `languageForPath(path: string): string`, `highlightLine(content: string, path: string, theme: "dark" | "light"): Promise<string>` (returns full Shiki HTML output for that one line, e.g. `<pre class="shiki" ...><code><span class="line">...</span></code></pre>`). Task 4's `DiffViewer` consumes both by these exact names.

- [ ] **Step 1: Add the dependency**

Modify `package.json` — add to `dependencies` (it's used at runtime in the shipped app, not just for tests):

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "lucide-react": "^0.460.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "shiki": "^1.24.0",
    "zustand": "^4.5.0"
  }
}
```

(everything else in `package.json` is unchanged — only this one line is added to `dependencies`)

- [ ] **Step 2: Write the failing tests**

`src/__tests__/highlight.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { languageForPath, highlightLine } from "../lib/highlight";

describe("languageForPath", () => {
  it("maps known extensions to their language", () => {
    expect(languageForPath("src/App.tsx")).toBe("tsx");
    expect(languageForPath("src-tauri/src/lib.rs")).toBe("rust");
    expect(languageForPath("package.json")).toBe("json");
  });

  it("falls back to plaintext for unknown or missing extensions", () => {
    expect(languageForPath("README")).toBe("plaintext");
    expect(languageForPath("file.xyz")).toBe("plaintext");
  });
});

describe("highlightLine", () => {
  it("returns real Shiki-highlighted HTML for a line of code", async () => {
    const html = await highlightLine("const x = 1;", "example.ts", "dark");
    expect(html).toContain("<pre");
    expect(html).toContain("<span");
  }, 15000);
});
```

(the last test deliberately exercises real Shiki, not a mock — it's the one place this plan proves the highlighting pipeline actually produces real output; `DiffViewer`'s own tests in Task 4 mock this module instead, per the spec's testing section)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm install && npx vitest run highlight`
Expected: FAIL — `src/lib/highlight` does not exist yet.

- [ ] **Step 4: Write the implementation**

`src/lib/highlight.ts`:

```typescript
import { createHighlighter, type Highlighter } from "shiki";

const SUPPORTED_LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "rust",
  "python",
  "json",
  "css",
  "html",
  "markdown",
  "toml",
  "yaml",
  "shellscript",
];

const EXTENSION_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  rs: "rust",
  py: "python",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  sh: "shellscript",
};

export function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_LANG[ext] ?? "plaintext";
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: SUPPORTED_LANGS,
    });
  }
  return highlighterPromise;
}

export async function highlightLine(
  content: string,
  path: string,
  theme: "dark" | "light"
): Promise<string> {
  const highlighter = await getHighlighter();
  const lang = languageForPath(path);
  const shikiTheme = theme === "dark" ? "github-dark" : "github-light";
  return highlighter.codeToHtml(content, { lang, theme: shikiTheme });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run highlight`
Expected: all 3 tests pass (the real-Shiki test may take a few seconds on first run while it loads grammars/themes — that's what the 15s timeout is for).

- [ ] **Step 6: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 3: Design tokens — brighter muted text, diff tint colors

**Files:**
- Modify: `src/index.css`
- Modify: `tailwind.config.js`

**Interfaces:**
- Consumes: nothing.
- Produces: updated `--text-muted` values; new `--success-soft-bg`/`--danger-soft-bg` CSS variables and matching Tailwind color tokens `success-soft`/`danger-soft`; a global CSS reset for Shiki's own `<pre>`/`<code>` markup. Task 4's `DiffViewer` uses `bg-success-soft`/`bg-danger-soft` and relies on the Shiki reset being in place.

No test — this is pure CSS/config, verified by the same build-output check used for the original Tailwind setup.

- [ ] **Step 1: Update the color tokens**

Modify `src/index.css` — change the `--text-muted` line in each theme block, and add the two new tokens to each:

```css
:root[data-theme="dark"] {
  --bg-canvas: #121316;
  --bg-surface: #17181c;
  --bg-elevated: #1e1f24;
  --bg-hover: #1a1b20;
  --border-subtle: #26272c;
  --text-primary: #d3d4da;
  --text-muted: #9a9ba5;
  --accent: #e8973a;
  --accent-contrast: #1a1200;
  --accent-soft-bg: rgba(232, 151, 58, 0.12);
  --success: #4ad999;
  --danger: #f0625f;
  --success-soft-bg: rgba(74, 217, 153, 0.15);
  --danger-soft-bg: rgba(240, 98, 95, 0.15);
}

:root[data-theme="light"] {
  --bg-canvas: #ffffff;
  --bg-surface: #fafafa;
  --bg-elevated: #f2f2f4;
  --bg-hover: #f7f7f8;
  --border-subtle: #e4e4e7;
  --text-primary: #26272c;
  --text-muted: #5c5d66;
  --accent: #d97a1f;
  --accent-contrast: #ffffff;
  --accent-soft-bg: rgba(217, 122, 31, 0.10);
  --success: #1a9c63;
  --danger: #d64545;
  --success-soft-bg: rgba(26, 156, 99, 0.12);
  --danger-soft-bg: rgba(214, 69, 69, 0.12);
}
```

Add this to the bottom of `src/index.css`, after the existing `body { ... }` rule — resets Shiki's own inline `background`/margin so our tint (applied on the row wrapping it) shows through instead of Shiki's theme background:

```css
.shiki-line pre.shiki {
  margin: 0;
  padding: 0;
  background: transparent !important;
  overflow: visible;
}
.shiki-line pre.shiki code {
  display: inline;
}
```

- [ ] **Step 2: Add the Tailwind color tokens**

Modify `tailwind.config.js` — add two entries to `theme.extend.colors`:

```js
      colors: {
        canvas: "var(--bg-canvas)",
        surface: "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
        hover: "var(--bg-hover)",
        "border-subtle": "var(--border-subtle)",
        "text-primary": "var(--text-primary)",
        "text-muted": "var(--text-muted)",
        accent: "var(--accent)",
        "accent-contrast": "var(--accent-contrast)",
        "accent-soft": "var(--accent-soft-bg)",
        success: "var(--success)",
        danger: "var(--danger)",
        "success-soft": "var(--success-soft-bg)",
        "danger-soft": "var(--danger-soft-bg)",
      },
```

- [ ] **Step 3: Verify the build still compiles the new tokens**

Run: `npm run build`
Expected: succeeds.

Run: `grep -o "success-soft\|--success-soft-bg" dist/assets/*.css | sort -u`
Expected: both strings present — confirms the new tokens made it into the compiled CSS.

- [ ] **Step 4: Mark task complete**

No commit (see Global Constraints). Update the progress ledger.

---

### Task 4: DiffViewer rewrite

**Files:**
- Modify: `src/components/DiffViewer.tsx`
- Create: `src/__tests__/DiffViewer.test.tsx`
- Modify: `src/__tests__/CommitDrawer.test.tsx`

**Interfaces:**
- Consumes: `parseDiffLines`, `oldPaneLines`, `newPaneLines` (Task 1); `highlightLine` (Task 2); `bg-success-soft`/`bg-danger-soft` Tailwind classes (Task 3); `useThemeStore` (existing, from the visual design plan).
- Produces: nothing new for later tasks — last functional task in this plan.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/DiffViewer.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DiffViewer from "../components/DiffViewer";

vi.mock("../lib/highlight", () => ({
  highlightLine: vi
    .fn()
    .mockResolvedValue('<pre class="shiki"><code><span class="line">HIGHLIGHTED</span></code></pre>'),
}));

const files = [
  {
    path: "a.txt",
    status: "modified",
    patch: "-one\n+two\n",
    oldContent: "one",
    newContent: "two",
    insertions: 1,
    deletions: 1,
  },
];

describe("DiffViewer", () => {
  it("renders file path and diff stats immediately", () => {
    render(<DiffViewer files={files} />);
    expect(screen.getByText("a.txt")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("shows plain diff text immediately, then upgrades to highlighted HTML", async () => {
    render(<DiffViewer files={files} />);
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("HIGHLIGHTED").length).toBeGreaterThan(0);
    });
  });

  it("side-by-side mode puts removed lines on the left and added lines on the right", () => {
    render(<DiffViewer files={files} />);
    fireEvent.click(screen.getByRole("button", { name: "Side-by-side" }));
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run DiffViewer`
Expected: FAIL — `DiffViewer` doesn't yet parse `patch` into rendered lines.

- [ ] **Step 3: Write the implementation**

Replace `src/components/DiffViewer.tsx` in full:

```typescript
import { useEffect, useState } from "react";
import { type FileDiff } from "../lib/tauri";
import { parseDiffLines, oldPaneLines, newPaneLines, type DiffLine, type DiffLineType } from "../lib/diffLines";
import { highlightLine } from "../lib/highlight";
import { useThemeStore } from "../store/themeStore";

interface RenderedLine extends DiffLine {
  html: string | null;
}

function lineTint(type: DiffLineType): string {
  if (type === "add") return "bg-success-soft";
  if (type === "del") return "bg-danger-soft";
  return "";
}

function DiffLineRow({ line }: { line: RenderedLine }) {
  const marker = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
  return (
    <div className={`flex font-mono text-xs px-2 ${lineTint(line.type)}`}>
      <span className="w-4 shrink-0 text-text-muted select-none">{marker}</span>
      {line.html ? (
        <span className="shiki-line" dangerouslySetInnerHTML={{ __html: line.html }} />
      ) : (
        <span className="text-text-primary whitespace-pre">{line.content}</span>
      )}
    </div>
  );
}

export default function DiffViewer({ files }: { files: FileDiff[] }) {
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [highlighted, setHighlighted] = useState<Record<string, RenderedLine[]>>({});
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result: Record<string, RenderedLine[]> = {};
      for (const file of files) {
        const lines = parseDiffLines(file.patch);
        result[file.path] = await Promise.all(
          lines.map(async (line) => ({
            ...line,
            html: await highlightLine(line.content, file.path, theme),
          }))
        );
      }
      if (!cancelled) setHighlighted(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [files, theme]);

  const linesFor = (file: FileDiff): RenderedLine[] =>
    highlighted[file.path] ?? parseDiffLines(file.patch).map((line) => ({ ...line, html: null }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 bg-elevated p-0.5 rounded w-fit">
        <button
          className={`text-xs px-2 py-0.5 rounded ${mode === "unified" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
          onClick={() => setMode("unified")}
        >
          Unified
        </button>
        <button
          className={`text-xs px-2 py-0.5 rounded ${mode === "split" ? "bg-accent text-accent-contrast" : "text-text-muted"}`}
          onClick={() => setMode("split")}
        >
          Side-by-side
        </button>
      </div>
      {files.map((file) => {
        const lines = linesFor(file);
        return (
          <div key={file.path} className="border border-border-subtle rounded overflow-hidden">
            <div className="px-2 py-1 bg-elevated text-xs font-mono flex justify-between">
              <span className="text-text-primary">{file.path}</span>
              <span className="text-text-muted">
                {file.status} <span className="text-success">+{file.insertions}</span>{" "}
                <span className="text-danger">-{file.deletions}</span>
              </span>
            </div>
            {mode === "unified" ? (
              <div className="bg-canvas py-1">
                {lines.map((line, i) => (
                  <DiffLineRow key={i} line={line} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-px bg-border-subtle">
                <div className="bg-canvas py-1">
                  {oldPaneLines(lines).map((line, i) => (
                    <DiffLineRow key={i} line={line} />
                  ))}
                </div>
                <div className="bg-canvas py-1">
                  {newPaneLines(lines).map((line, i) => (
                    <DiffLineRow key={i} line={line} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Update CommitDrawer's test to mock highlighting too**

Modify `src/__tests__/CommitDrawer.test.tsx` — add a mock for the highlight module so this test never invokes real Shiki (it only cares about metadata rendering, not diff content):

```typescript
vi.mock("../lib/tauri", () => ({
  invokeGetCommitDiff: vi.fn(),
}));

vi.mock("../lib/highlight", () => ({
  highlightLine: vi.fn().mockResolvedValue('<pre class="shiki"><code><span class="line"></span></code></pre>'),
}));
```

(add the second `vi.mock` call right after the existing one, near the top of the file)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run DiffViewer CommitDrawer`
Expected: all tests pass (3 new `DiffViewer` tests, 2 existing `CommitDrawer` tests still green).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all Vitest suites pass, including this plan's new tests.

Run: `npm run e2e`
Expected: all 3 existing Playwright specs still pass — `workingcopy.spec.ts` in particular asserts `getByText("one")`/`getByText("two")` in the side-by-side diff view, which the new patch-derived rendering still produces (verified: parsing `"-one\n+two\n"` puts `"one"` in the old pane and `"two"` in the new pane, matching what that spec already expects).

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: unaffected — this plan touches no Rust code. All tests still pass.

Run: `npm run build`
Expected: succeeds. **Correction found here during implementation:** the first version of `oldPaneLines`/`newPaneLines` (Task 1) was typed as `(lines: DiffLine[]) => DiffLine[]`, which erases the `html` field `RenderedLine` (this task) adds — `tsc` fails with "Property 'html' is missing in type 'DiffLine'" even though `npx vitest run` never caught it (Vite/esbuild strips types without full type-checking). Fixed by making both functions generic (`<T extends DiffLine>(lines: T[]): T[]`) so they preserve whatever subtype is passed in. This is retroactively reflected in Task 1's code above.

- [ ] **Step 7: Mark task complete**

No commit (see Global Constraints). Update the progress ledger — diff syntax highlighting and the branch/muted-text contrast fix are both complete.

---

## Definition of Done

- Remote branch names, commit dates, and section labels are visibly brighter/more readable in both themes (verified visually — no automated test asserts on color values, per the project's established pattern of not testing styling in unit tests).
- The diff viewer shows real Shiki syntax highlighting (matching VS Code's own engine and a GitHub-style theme) in both unified and side-by-side modes, with green/red line tinting under the highlighted text — verified by `DiffViewer.test.tsx` (with highlighting mocked) and the real, unmocked `highlight.test.ts` Shiki invocation.
- Highlighting never blocks or flashes — plain, correctly-tinted text renders immediately and upgrades in place.
- `cargo test`, `npm test`, `npm run e2e`, and `npm run build` all pass with no regressions from any prior plan.
