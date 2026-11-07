import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeReleaseNotesCommits: vi.fn(),
  invokeGetRepoSettings: vi.fn(),
  invokeAddReleaseNote: vi.fn().mockResolvedValue({ id: 1, fromLabel: "", toLabel: "", text: "", createdAt: 1 }),
  invokeListReleaseNotes: vi.fn().mockResolvedValue([]),
  invokeDeleteReleaseNote: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(true),
  copyRich: vi.fn().mockResolvedValue(true),
}));

import * as tauri from "../lib/tauri";
import { copyRich } from "../lib/clipboard";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { useToastStore } from "../store/toastStore";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import ReleaseNotesDialog from "../components/ReleaseNotesDialog";

const from = { oid: "f", label: "tag v1", timestamp: 100 };
const to = { oid: "t", label: "HEAD tip", timestamp: 200 };

describe("ReleaseNotesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useReleaseNotesStore.getState().clear();
    useRepoSettingsStore.setState({ byPath: {} });
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(DEFAULT_REPO_SETTINGS);
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/r", name: "r", pinned: false }],
      activeRepoId: 1,
    } as never);
    vi.mocked(tauri.invokeReleaseNotesCommits).mockResolvedValue([
      { oid: "a", subject: "CEM-1 | one (#1)", timestamp: Math.floor(new Date("2026-10-04T12:00:00").getTime() / 1000) },
    ]);
  });

  it("renders nothing until both ends are marked", () => {
    render(<ReleaseNotesDialog />);
    act(() => useReleaseNotesStore.getState().markFrom(from));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("loads the range and shows the formatted list with both ends", async () => {
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);

    const box = await screen.findByLabelText("Release notes text");
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe("- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10"));
    expect(tauri.invokeReleaseNotesCommits).toHaveBeenCalledWith("/r", "f", "t");
    expect(screen.getByText(/tag v1/)).toBeTruthy();
    expect(screen.getByText(/HEAD tip/)).toBeTruthy();
  });

  it("copies the list and toasts", async () => {
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    await waitFor(() => expect(screen.getByLabelText("Release notes text")).toHaveProperty("value", "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10"));

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(copyRich).toHaveBeenCalledWith(
      '<ul><li><a href="https://cemento.atlassian.net/browse/CEM-1">CEM-1</a> | one (#1), 04/10</li></ul>',
      "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10"
    ));
  });

  it("swap re-queries with the ends exchanged", async () => {
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    await screen.findByLabelText("Release notes text");

    fireEvent.click(screen.getByRole("button", { name: "Swap" }));

    await waitFor(() => expect(tauri.invokeReleaseNotesCommits).toHaveBeenCalledWith("/r", "t", "f"));
  });

  it("shows the error when the query fails", async () => {
    vi.mocked(tauri.invokeReleaseNotesCommits).mockRejectedValue("boom");
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);

    expect(await screen.findByText(/boom/)).toBeTruthy();
  });

  it("Escape clears the marks and closes", async () => {
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useReleaseNotesStore.getState().from).toBeNull();
  });

  it("shows how many commits are in the range", async () => {
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    expect(await screen.findByText("1 commit")).toBeTruthy();
  });

  it("lets you edit the text and copies the edited version", async () => {
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    const box = await screen.findByLabelText("Release notes text");
    await waitFor(() => expect(box).toHaveProperty("value", "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10"));

    fireEvent.change(box, { target: { value: "- reworded" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(copyRich).toHaveBeenCalledWith("<ul><li>reworded</li></ul>", "- reworded"));
  });

  it("toggles drop dates and PR numbers from the list", async () => {
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    const box = await screen.findByLabelText("Release notes text");
    await waitFor(() => expect(box).toHaveProperty("value", "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10"));

    fireEvent.click(screen.getByLabelText("Dates"));
    expect(box).toHaveProperty("value", "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1)");
    fireEvent.click(screen.getByLabelText("PR numbers"));
    expect(box).toHaveProperty("value", "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one");
    expect(tauri.invokeReleaseNotesCommits).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Enter copies and closes", async () => {
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    const box = await screen.findByLabelText("Release notes text");
    await waitFor(() => expect(box).toHaveProperty("value", "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10"));

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });

    await waitFor(() => expect(copyRich).toHaveBeenCalledWith(
      '<ul><li><a href="https://cemento.atlassian.net/browse/CEM-1">CEM-1</a> | one (#1), 04/10</li></ul>',
      "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10"
    ));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Jira links toggle swaps ticket links for plain ids", async () => {
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    const box = await screen.findByLabelText("Release notes text");
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toContain("](https://cemento.atlassian.net/browse/CEM-1)"));

    fireEvent.click(screen.getByLabelText("Jira links"));

    expect(box).toHaveProperty("value", "- CEM-1 | one (#1), 04/10");
  });

  it("uses the repo's ticket pattern, so ids outside it stay plain", async () => {
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue({ ...DEFAULT_REPO_SETTINGS, ticketPattern: "ABC-\\d+" });
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);
    const box = await screen.findByLabelText("Release notes text");

    await waitFor(() => expect(box).toHaveProperty("value", "- CEM-1 | one (#1), 04/10"));
  });

  it("disables the Jira links checkbox when the repo has no Jira URL", async () => {
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue({ ...DEFAULT_REPO_SETTINGS, jiraBaseUrl: "" });
    useReleaseNotesStore.getState().markFrom(from);
    useReleaseNotesStore.getState().markTo(to);
    render(<ReleaseNotesDialog />);

    await waitFor(() => expect(screen.getByLabelText("Jira links")).toBeDisabled());
  });
});
