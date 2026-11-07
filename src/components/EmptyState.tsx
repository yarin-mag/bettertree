import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
  /** Raw error text, tucked into a collapsible so the headline stays friendly. */
  details?: string;
  variant?: "default" | "error";
  /** Tighter spacing for narrow spots like the sidebar. */
  compact?: boolean;
}

export default function EmptyState({ icon, title, hint, action, details, variant = "default", compact }: EmptyStateProps) {
  const isError = variant === "error";
  return (
    <div
      role={isError ? "alert" : undefined}
      className={`flex flex-col items-center justify-center text-center gap-2 animate-pop-in ${compact ? "p-3" : "p-8"}`}
    >
      <div
        className={`flex items-center justify-center rounded-full bg-elevated border border-border-subtle ${
          compact ? "w-8 h-8" : "w-11 h-11"
        } ${isError ? "text-danger" : "text-text-muted"}`}
      >
        {icon ?? (isError ? <AlertTriangle size={compact ? 14 : 18} /> : null)}
      </div>
      <div className="text-sm font-medium text-text-primary">{title}</div>
      {hint && <div className="text-xs text-text-muted max-w-sm">{hint}</div>}
      {action && (
        <button
          type="button"
          className="mt-1 px-3 py-1.5 bg-accent text-accent-contrast rounded text-xs font-medium hover:brightness-110 press-scale"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
      {details && (
        <details className="mt-1 max-w-md w-full text-left">
          <summary className="text-xs text-text-muted cursor-pointer text-center">Details</summary>
          <pre className="mt-1 p-2 text-[11px] font-mono whitespace-pre-wrap break-words bg-elevated border border-border-subtle rounded text-text-muted">
            {details}
          </pre>
        </details>
      )}
    </div>
  );
}
