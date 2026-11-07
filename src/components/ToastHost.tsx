import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useToastStore, type ToastKind } from "../store/toastStore";

const ICONS: Record<ToastKind, typeof Info> = { success: CheckCircle2, error: AlertCircle, info: Info };
const COLORS: Record<ToastKind, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-accent",
};

export default function ToastHost() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-80" role="region" aria-label="Notifications">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="flex items-start gap-2 rounded-lg border border-border-subtle bg-elevated px-3 py-2 shadow-lg text-xs text-text-primary animate-pop-in"
          >
            <Icon size={14} className={`mt-0.5 shrink-0 ${COLORS[t.kind]}`} />
            <div className="flex-1 min-w-0 break-words">
              {t.message}
              {t.action && (
                <button
                  className="ml-2 text-accent hover:underline"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              className="text-text-muted hover:text-text-primary shrink-0"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
