import { describe, it, expect } from "vitest";
import { languageForPath, highlightLine } from "../lib/highlight";

describe("languageForPath", () => {
  it("maps known extensions to their language", () => {
    expect(languageForPath("src/App.tsx")).toBe("tsx");
    expect(languageForPath("src-tauri/src/lib.rs")).toBe("rust");
    expect(languageForPath("package.json")).toBe("json");
  });

  it("falls back to plaintext for unknown or missing extensions", () => {
    expect(languageForPath("README")).toBe("plaintext");
    expect(languageForPath("file.xyz")).toBe("plaintext");
  });
});

describe("highlightLine", () => {
  it("returns real Shiki-highlighted HTML for a line of code", async () => {
    const html = await highlightLine("const x = 1;", "example.ts", "dark");
    expect(html).toContain("<pre");
    expect(html).toContain("<span");
  }, 15000);
});
