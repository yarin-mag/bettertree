import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronRight, ChevronUp, Copy, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { invokeCiJobLog, type CiJob, type CiState, type CiWorkflowRun, type JobLog } from "../lib/tauri";
import { firstFailedStep, parseLogSteps } from "../lib/ci";
import { parseAnsi, type AnsiSegment } from "../lib/ansi";
import { copyText } from "../lib/clipboard";
import { toast } from "../store/toastStore";
import { useVirtualList } from "../hooks/useVirtualList";
import EmptyState from "./EmptyState";
import { StateIcon } from "./WorkflowCard";

const ROW_HEIGHT = 18;

const ICON_BUTTON =
  "inline-flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-hover disabled:opacity-30 press-scale";

interface Props {
  repoPath: string;
  job: CiJob;
  run: CiWorkflowRun;
  onClose: () => void;
}

type Row =
  | { kind: "header"; step: number; name: string; count: number }
  | { kind: "line"; step: number; line: number; text: string; lineNo: number };

function stepState(conclusion: string | null | undefined, status: string | undefined): CiState {
  if (status === undefined) return "none";
  if (status !== "completed") return "pending";
  const c = (conclusion ?? "").toLowerCase();
  if (c === "success" || c === "neutral" || c === "skipped") return "success";
  return c === "" ? "none" : "failure";
}

/** Steps to open when a log loads: the first failed step, else only the first step (top of the log). */
function initialOpen(text: string, job: CiJob): Set<number> {
  const steps = parseLogSteps(text);
  const failedNumber = firstFailedStep(job);
  const failedName = failedNumber === null ? undefined : job.steps.find((s) => s.number === failedNumber)?.name;
  const idx = failedName === undefined ? -1 : steps.findIndex((s) => s.stepName === failedName);
  return new Set(steps.length ? [idx >= 0 ? idx : 0] : []);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const plainText = (segments: AnsiSegment[]) => segments.map((s) => s.text).join("");

/** Match ranges in `plain`, case-insensitive and literal. */
function findRanges(plain: string, re: RegExp | null): [number, number][] {
  if (!re) return [];
  const out: [number, number][] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) {
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function LineContent({ text, re, firstOrdinal, currentOrdinal }: { text: string; re: RegExp | null; firstOrdinal: number; currentOrdinal: number }) {
  const segments = parseAnsi(text);
  const ranges = findRanges(plainText(segments), re);
  if (ranges.length === 0) {
    return (
      <>
        {segments.map((s, i) => (
          <span key={i} className={s.className}>{s.text}</span>
        ))}
      </>
    );
  }
  const pieces: { text: string; className: string; ordinal: number | null }[] = [];
  let offset = 0;
  for (const seg of segments) {
    const segEnd = offset + seg.text.length;
    let pos = offset;
    while (pos < segEnd) {
      const rangeIdx = ranges.findIndex(([s, e]) => pos < e && s < segEnd);
      const range = rangeIdx >= 0 ? ranges[rangeIdx] : null;
      if (!range || range[0] >= segEnd) {
        pieces.push({ text: seg.text.slice(pos - offset), className: seg.className, ordinal: null });
        break;
      }
      if (pos < range[0]) {
        pieces.push({ text: seg.text.slice(pos - offset, range[0] - offset), className: seg.className, ordinal: null });
        pos = range[0];
      }
      const end = Math.min(range[1], segEnd);
      pieces.push({ text: seg.text.slice(pos - offset, end - offset), className: seg.className, ordinal: firstOrdinal + rangeIdx });
      pos = end;
    }
    offset = segEnd;
  }
  return (
    <>
      {pieces.map((p, i) =>
        p.ordinal === null ? (
          <span key={i} className={p.className}>{p.text}</span>
        ) : (
          <mark
            key={i}
            data-current={p.ordinal === currentOrdinal ? "true" : "false"}
            className={`${p.className} ${p.ordinal === currentOrdinal ? "bg-accent text-accent-contrast" : "bg-accent-soft text-accent"}`}
          >
            {p.text}
          </mark>
        )
      )}
    </>
  );
}

export default function LogViewer({ repoPath, job, run, onClose }: Props) {
  const [log, setLog] = useState<JobLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const requestRef = useRef(0);
  const fullRef = useRef(false);
  const jobRef = useRef(job);
  jobRef.current = job;

  const load = useCallback(
    (full: boolean, keepOpen: boolean) => {
      const id = ++requestRef.current;
      fullRef.current = full;
      setLoading(true);
      setError(null);
      invokeCiJobLog(repoPath, jobRef.current.jobId, full)
        .then((result) => {
          if (id !== requestRef.current) return;
          setLog(result);
          if (!keepOpen) setOpen(initialOpen(result.text, jobRef.current));
          setLoading(false);
        })
        .catch((e) => {
          if (id !== requestRef.current) return;
          setError(String(e));
          setLoading(false);
        });
    },
    [repoPath]
  );

  // Reload when the job changes; a stale response (or one after unmount) is ignored via the request counter.
  useEffect(() => {
    setLog(null);
    load(false, false);
    return () => {
      requestRef.current++;
    };
  }, [load, job.jobId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const steps = useMemo(() => (log ? parseLogSteps(log.text) : []), [log]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    let lineNo = 0;
    steps.forEach((step, i) => {
      out.push({ kind: "header", step: i, name: step.stepName, count: step.lines.length });
      if (!open.has(i)) return;
      step.lines.forEach((text, line) => out.push({ kind: "line", step: i, line, text, lineNo: ++lineNo }));
    });
    return out;
  }, [steps, open]);

  const re = useMemo(() => (query ? new RegExp(escapeRegex(query), "gi") : null), [query]);

  // Matches are searched across all steps (open or not); a match in a closed step opens that step when selected.
  const matchInfo = useMemo(() => {
    const first = new Map<string, number>();
    const owners: { step: number; line: number }[] = [];
    if (re) {
      steps.forEach((step, si) => {
        step.lines.forEach((text, li) => {
          const n = findRanges(plainText(parseAnsi(text)), re).length;
          if (n === 0) return;
          first.set(`${si}:${li}`, owners.length);
          for (let k = 0; k < n; k++) owners.push({ step: si, line: li });
        });
      });
    }
    return { first, owners };
  }, [steps, re]);
  const total = matchInfo.owners.length;
  const currentOrdinal = total === 0 ? -1 : Math.min(current, total - 1);
  const pendingScroll = useRef(false);

  const { ref, onScroll, scrollToIndex, start, end, padTop, padBottom } = useVirtualList<HTMLDivElement>({ count: rows.length, itemHeight: ROW_HEIGHT });

  const goTo = (ordinal: number) => {
    if (total === 0) return;
    const next = ((ordinal % total) + total) % total;
    setCurrent(next);
    pendingScroll.current = true;
  };

  // Open the step holding the selected match, then scroll its row into view once rendered.
  const owner = currentOrdinal >= 0 ? matchInfo.owners[currentOrdinal] : undefined;
  useEffect(() => {
    if (owner && !open.has(owner.step)) setOpen((prev) => new Set(prev).add(owner.step));
  }, [owner, open]);
  useEffect(() => {
    if (!pendingScroll.current || !owner || !open.has(owner.step)) return;
    const index = rows.findIndex((r) => r.kind === "line" && r.step === owner.step && r.line === owner.line);
    if (index < 0) return;
    pendingScroll.current = false;
    scrollToIndex(index, "center");
  }, [rows, owner, open, scrollToIndex]);

  const toggle = (step: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(step)) next.add(step);
      return next;
    });

  const jobStepByName = useMemo(() => new Map(job.steps.map((s) => [s.name, s])), [job.steps]);

  const onCopy = async () => {
    if (log && (await copyText(log.text))) toast.success("Copied log");
  };

  const matchLabel = !query ? "" : total === 0 ? "No matches" : `${total} ${total === 1 ? "match" : "matches"}`;

  let body;
  if (error) {
    body = <EmptyState variant="error" title="Couldn't load log" details={error} action={{ label: "Retry", onClick: () => load(fullRef.current, false) }} />;
  } else if (!log) {
    body = (
      <div className="flex items-center justify-center gap-2 p-8 text-xs text-text-muted">
        <Loader2 size={14} className="animate-spin" /> Loading log…
      </div>
    );
  } else if (rows.length === 0) {
    body = <EmptyState title="Log is empty" hint="This job hasn't produced any output yet." />;
  } else {
    body = (
      <div ref={ref} onScroll={onScroll} className="flex-1 min-h-0 overflow-auto bg-base font-mono text-xs">
        <div style={{ height: padTop }} />
        {rows.slice(start, end).map((row, k) => {
          const index = start + k;
          if (row.kind === "header") {
            const isOpen = open.has(row.step);
            const meta = jobStepByName.get(row.name);
            return (
              <div key={index} data-open={isOpen ? "true" : "false"} style={{ height: ROW_HEIGHT }} className="flex items-center bg-elevated border-y border-border-subtle">
                <button type="button" aria-expanded={isOpen} className="flex items-center gap-1.5 w-full px-2 text-left text-text-primary hover:bg-hover" onClick={() => toggle(row.step)}>
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <StateIcon state={stepState(meta?.conclusion, meta?.status)} size={10} />
                  <span className="truncate">{row.name}</span>
                  <span className="text-text-muted">{row.count} {row.count === 1 ? "line" : "lines"}</span>
                </button>
              </div>
            );
          }
          return (
            <div key={index} style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }} className="flex whitespace-pre font-mono text-xs text-text-primary">
              <span className="w-12 shrink-0 pr-2 text-right text-text-muted select-none">{row.lineNo}</span>
              <span>
                <LineContent text={row.text} re={re} firstOrdinal={matchInfo.first.get(`${row.step}:${row.line}`) ?? 0} currentOrdinal={currentOrdinal} />
              </span>
            </div>
          );
        })}
        <div style={{ height: padBottom }} />
      </div>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-6 animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Job log"
        className="w-full max-w-5xl h-[80vh] bg-surface border border-border-subtle rounded-lg shadow-2xl flex flex-col overflow-hidden animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
          <div className="flex-1 min-w-0 truncate text-sm font-medium text-text-primary">
            {run.workflowName} › {job.name}
          </div>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label="Open job on GitHub"
            title="Open on GitHub"
            disabled={!job.url}
            onClick={() => openUrl(job.url).catch((err) => toast.error(`Failed to open job: ${err}`))}
          >
            <ExternalLink size={14} />
          </button>
          <button type="button" className={ICON_BUTTON} aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle">
          <input
            className="flex-1 min-w-0 px-2 py-1 bg-elevated border border-border-subtle rounded text-xs text-text-primary outline-none focus:border-accent"
            placeholder="Search log"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCurrent(0);
              pendingScroll.current = true;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goTo(currentOrdinal + (e.shiftKey ? -1 : 1));
              }
            }}
          />
          <span className="text-xs text-text-muted min-w-16">{matchLabel}</span>
          <button type="button" className={ICON_BUTTON} aria-label="Previous match" disabled={total === 0} onClick={() => goTo(currentOrdinal - 1)}>
            <ChevronUp size={14} />
          </button>
          <button type="button" className={ICON_BUTTON} aria-label="Next match" disabled={total === 0} onClick={() => goTo(currentOrdinal + 1)}>
            <ChevronDown size={14} />
          </button>
          <button type="button" className={ICON_BUTTON} aria-label="Copy log" title="Copy log" disabled={!log} onClick={onCopy}>
            <Copy size={14} />
          </button>
          {job.status !== "completed" && (
            <button type="button" className={ICON_BUTTON} aria-label="Refresh log" title="Refresh" disabled={loading} onClick={() => load(fullRef.current, true)}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          )}
        </div>
        {log?.truncated && !error && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated border-b border-border-subtle text-xs text-text-muted">
            <span>Showing the end of a large log.</span>
            <button type="button" className="text-accent hover:underline" onClick={() => load(true, false)}>
              Load full log
            </button>
          </div>
        )}
        {body}
      </div>
    </div>,
    document.body
  );
}
