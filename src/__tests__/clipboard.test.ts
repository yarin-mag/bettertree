import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { copyRich } from "../lib/clipboard";

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

describe("copyRich", () => {
  const write = vi.fn();
  const writeText = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    write.mockResolvedValue(undefined);
    writeText.mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { write, writeText } });
    (globalThis as any).ClipboardItem = class {
      constructor(public items: Record<string, Blob>) {}
    };
  });
  afterEach(() => {
    delete (globalThis as any).ClipboardItem;
  });

  it("writes html and plain text together", async () => {
    const ok = await copyRich("<ul><li>x</li></ul>", "- x");

    expect(ok).toBe(true);
    const item = write.mock.calls[0][0][0];
    expect(Object.keys(item.items).sort()).toEqual(["text/html", "text/plain"]);
    expect(await readBlob(item.items["text/html"])).toBe("<ul><li>x</li></ul>");
    expect(await readBlob(item.items["text/plain"])).toBe("- x");
  });

  it("falls back to plain text when rich copy is unavailable", async () => {
    write.mockRejectedValue(new Error("denied"));
    document.execCommand = vi.fn().mockReturnValue(false);

    await copyRich("<b>x</b>", "- x");

    expect(writeText).toHaveBeenCalledWith("- x");
  });
});
