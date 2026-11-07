import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, options?: { action?: Toast["action"]; durationMs?: number }) => number;
  dismiss: (id: number) => void;
}

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 7000;
let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, options) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, kind, message, action: options?.action }] });
    const duration = options?.durationMs ?? (kind === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);
    if (duration > 0) setTimeout(() => get().dismiss(id), duration);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (message: string, options?: Parameters<ToastState["push"]>[2]) =>
    useToastStore.getState().push("success", message, options),
  error: (message: string, options?: Parameters<ToastState["push"]>[2]) =>
    useToastStore.getState().push("error", message, options),
  info: (message: string, options?: Parameters<ToastState["push"]>[2]) =>
    useToastStore.getState().push("info", message, options),
};
