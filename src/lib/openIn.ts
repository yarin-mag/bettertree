import type { ContextMenuItem } from "../components/ContextMenu";
import { invokeOpenIn, type OpenTarget } from "./tauri";
import { copyWithToast } from "./branchActions";
import { toast } from "../store/toastStore";

function label(target: OpenTarget): string {
  return target.id === "finder" ? "Reveal in Finder" : `Open in ${target.label}`;
}

async function openIn(target: OpenTarget, repoPath: string): Promise<void> {
  try {
    await invokeOpenIn(target.id, repoPath);
  } catch (e) {
    toast.error(`Couldn't open in ${target.label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Menu entries for opening `repoPath` in each detected app, ending with Copy path. */
export function buildOpenInItems(repoPath: string, targets: OpenTarget[]): ContextMenuItem[] {
  return [
    ...targets.map((t) => ({ label: label(t), onSelect: () => void openIn(t, repoPath) })),
    { label: "Copy path", onSelect: () => void copyWithToast(repoPath, "path") },
  ];
}
