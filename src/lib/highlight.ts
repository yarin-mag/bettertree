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
