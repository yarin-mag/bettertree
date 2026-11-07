import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

import { openUrl } from "@tauri-apps/plugin-opener";
import Markdown from "../components/Markdown";

describe("Markdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (openUrl as any).mockResolvedValue(undefined);
  });

  it("opens links via the system opener instead of navigating in the app", () => {
    render(<Markdown>{"[GitHub](https://github.com/acme/widgets/pull/42)"}</Markdown>);

    const link = screen.getByRole("link", { name: "GitHub" });
    const event = fireEvent.click(link);

    expect(openUrl).toHaveBeenCalledWith("https://github.com/acme/widgets/pull/42");
    expect(event).toBe(false); // fireEvent.click returns false when preventDefault was called
  });

  it("logs instead of throwing when the opener rejects (e.g. a missing permission)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    (openUrl as any).mockRejectedValue(new Error("opener not allowed"));

    render(<Markdown>{"[GitHub](https://github.com/acme/widgets/pull/42)"}</Markdown>);
    fireEvent.click(screen.getByRole("link", { name: "GitHub" }));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith("failed to open link externally:", expect.any(Error));
    });
    consoleError.mockRestore();
  });
});
