import { useEffect, useRef, useState } from "react";

interface DateRangeFilterProps {
  value: string | undefined;
  onChange: (value: string | null) => void;
}

function isoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

const PRESETS: { label: string; compute: () => { from: string; to: string } }[] = [
  {
    label: "Today",
    compute: () => {
      const today = isoDate(new Date());
      return { from: today, to: today };
    },
  },
  {
    label: "Last 7 days",
    compute: () => ({ from: isoDate(daysAgo(6)), to: isoDate(new Date()) }),
  },
  {
    label: "Last 30 days",
    compute: () => ({ from: isoDate(daysAgo(29)), to: isoDate(new Date()) }),
  },
  {
    label: "This month",
    compute: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: isoDate(first), to: isoDate(now) };
    },
  },
];

function parseRange(value: string | undefined): { from: string; to: string } {
  if (!value) return { from: "", to: "" };
  if (value.includes("..")) {
    const [from, to] = value.split("..");
    return { from, to };
  }
  if (value.startsWith(">=")) return { from: value.slice(2), to: "" };
  if (value.startsWith("<=")) return { from: "", to: value.slice(2) };
  return { from: "", to: "" };
}

function buildValue(from: string, to: string): string | null {
  if (from && to) return `${from}..${to}`;
  if (from) return `>=${from}`;
  if (to) return `<=${to}`;
  return null;
}

function summarize(value: string | undefined): string {
  const { from, to } = parseRange(value);
  if (from && to) return `${from} → ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return "Any";
}

export default function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { from, to } = parseRange(value);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="w-32 px-2 py-1 bg-elevated border border-border-subtle rounded text-text-primary text-left truncate"
        onClick={() => setIsOpen((o) => !o)}
      >
        {summarize(value)}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-64 bg-elevated border border-border-subtle rounded-lg shadow-lg p-2 flex flex-col gap-2 animate-pop-in">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  const { from: f, to: t } = p.compute();
                  onChange(buildValue(f, t));
                }}
                className="px-2 py-0.5 rounded text-[11px] bg-hover text-text-primary hover:bg-accent-soft"
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => onChange(buildValue(e.target.value, to))}
              className="bg-elevated border border-border-subtle rounded px-1 py-0.5 text-text-primary"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => onChange(buildValue(from, e.target.value))}
              className="bg-elevated border border-border-subtle rounded px-1 py-0.5 text-text-primary"
            />
          </label>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="self-start text-[11px] text-text-muted hover:text-danger"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
