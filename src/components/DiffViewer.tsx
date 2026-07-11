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
    setHighlighted({});
    (async () => {
      let sinceYield = 0;
      for (const file of files) {
        if (cancelled) return;
        const lines = parseDiffLines(file.patch);
        const rendered: RenderedLine[] = [];
        for (const line of lines) {
          if (cancelled) return;
          rendered.push({ ...line, html: await highlightLine(line.content, file.path, theme) });
          sinceYield++;
          if (sinceYield >= 40) {
            sinceYield = 0;
            await new Promise((r) => setTimeout(r, 0));
            if (cancelled) return;
          }
        }
        if (cancelled) return;
        setHighlighted((prev) => ({ ...prev, [file.path]: rendered }));
      }
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
