import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../lib/tauri", () => ({
  invokeGetCommitDiff: vi.fn(),
}));
vi.mock("../lib/highlight", () => ({ highlightLine: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import * as tauriLib from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { useUiStore } from "../store/uiStore";
import { useModalLayoutStore } from "../store/modalLayoutStore";
import CommitDrawer from "../components/CommitDrawer";

describe("CommitDrawer modal and height", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 1200, configurable: true, writable: true });
    useModalLayoutStore.setState({ size: null, fullscreen: false });
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      commits: [],
    } as never);
    useGithubStore.setState({ status: null });
    useUiStore.setState({ selectedCommitOid: "c2", drawerTab: "diff" } as never);
    (tauriLib.invokeGetCommitDiff as any).mockResolvedValue({
      oid: "c2",
      author: "A",
      email: "a@x",
      timestamp: 1,
      message: "msg",
      parents: [],
      files: [],
    });
  });

  it("the modal gets full-screen, reset and resize controls", async () => {
    render(<CommitDrawer />);
    fireEvent.click(await screen.findByLabelText("Open in modal"));

    expect(screen.getByRole("dialog", { name: "Commit" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("dialog", { name: "Commit" })).toHaveAttribute("data-fullscreen", "true");
  });

  it("Escape still closes the modal", async () => {
    render(<CommitDrawer />);
    fireEvent.click(await screen.findByLabelText("Open in modal"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Commit" })).toBeNull();
  });

  it("the bottom drawer can be dragged taller than the old 640px limit in a tall window", async () => {
    const { container } = render(<CommitDrawer />);
    await screen.findByLabelText("Open in modal");
    const drawer = container.firstChild as HTMLElement;
    const handle = drawer.querySelector(".cursor-row-resize") as HTMLElement;

    fireEvent.mouseDown(handle, { clientY: 800 });
    fireEvent.mouseMove(window, { clientY: -400 });
    fireEvent.mouseUp(window);

    expect(parseInt(drawer.style.height)).toBeGreaterThan(640);
    expect(parseInt(drawer.style.height)).toBeLessThanOrEqual(960);
  });
});
