// navigator.clipboard can be unavailable or rejected inside the desktop
// webview, so fall back to a hidden textarea + execCommand.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through to the legacy path
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copies `html` and `text` together so rich editors (Slack, docs) paste the
 * links while plain editors get `text`. Falls back to plain text if the rich
 * clipboard is unavailable.
 */
export async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // fall through to the selection-based path
  }
  try {
    const el = document.createElement("div");
    el.contentEditable = "true";
    el.innerHTML = html;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const ok = document.execCommand("copy");
    selection?.removeAllRanges();
    document.body.removeChild(el);
    if (ok) return true;
  } catch {
    // fall through to plain text
  }
  return copyText(text);
}
