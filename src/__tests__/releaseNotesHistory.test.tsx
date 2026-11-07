import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeReleaseNotesCommits: vi.fn(),
  invokeGetRepoSettings: vi.fn(),
  invokeAddReleaseNote: vi.fn(),
  invokeListReleaseNotes: vi.fn(),
  invokeDeleteReleaseNote: vi.fn(),
}));
vi.mock("../lib/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(true),
  copyRich: vi.fn().mockResolvedValue(true),
}));

import * as tauri from "../lib/tauri";
import { copyRich } from "../lib/clipboard";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useReleaseNotesHistoryStore } from "../store/releaseNotesHistoryStore";
import { useToastStore } from "../store/toastStore";
import ReleaseNotesDialog from "../components/ReleaseNotesDialog";

const from = { oid: "f", label: "tag v1", timestamp: 100 };
const to = { oid: "t", label: "HEAD tip", timestamp: 200 };
const LIVE = "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10";
const saved = (over = {}) => ({ id: 7, fromLabel: "tag v0", toLabel: "tag v1", text: "- old <b>note</b> & more", createdAt: 1_760_000_000, ...over });

async function openDialog() {
  useReleaseNotesStore.getState().markFrom(from);
  useReleaseNotesStore.getState().markTo(to);
  render(<ReleaseNotesDialog />);
  const box = await screen.findByLabelText("Release notes text");
  await waitFor(() => expect(box).toHaveProperty("value", LIVE));
  return box as HTMLTextAreaElement;
}

describe("release notes history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useReleaseNotesStore.getState().clear();
    useRepoSettingsStore.setState({ byPath: {} });
    useReleaseNotesHistoryStore.setState({ byRepo: {} });
    useWorkspaceStore.setState({ repos: [{ id: 1, path: "/r", name: "r", pinned: false }], activeRepoId: 1 } as never);
    vi.mocked(copyRich).mockResolvedValue(true);
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(DEFAULT_REPO_SETTINGS);
    vi.mocked(tauri.invokeReleaseNotesCommits).mockResolvedValue([
      { oid: "a", subject: "CEM-1 | one (#1)", timestamp: Math.floor(new Date("2026-10-04T12:00:00").getTime() / 1000) },
    ]);
    vi.mocked(tauri.invokeAddReleaseNote).mockImplementation(async (_p, f, t, text) => ({ id: 99, fromLabel: f, toLabel: t, text, createdAt: 1 }));
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([]);
    vi.mocked(tauri.invokeDeleteReleaseNote).mockResolvedValue(undefined);
  });

  it("saves what was copied, with the range labels, when you press Copy", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(tauri.invokeAddReleaseNote).toHaveBeenCalledWith("/r", "tag v1", "HEAD tip", LIVE));
  });

  it("saves the edited text on Cmd+Enter", async () => {
    const box = await openDialog();
    fireEvent.change(box, { target: { value: "- reworded" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(tauri.invokeAddReleaseNote).toHaveBeenCalledWith("/r", "tag v1", "HEAD tip", "- reworded"));
  });

  it("does not save when the copy itself failed", async () => {
    vi.mocked(copyRich).mockResolvedValueOnce(false);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(copyRich).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(tauri.invokeAddReleaseNote).not.toHaveBeenCalled();
  });

  it("a failing save only toasts; the copy still happened", async () => {
    vi.mocked(tauri.invokeAddReleaseNote).mockRejectedValue("disk full");
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => /history/i.test(t.message))).toBe(true));
    expect(copyRich).toHaveBeenCalled();
  });

  it("History shows the saved list newest first, or an empty message", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText(/Nothing saved yet/i)).toBeTruthy();

    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved({ id: 8, fromLabel: "tag v1", toLabel: "HEAD" }), saved()]);
    fireEvent.click(screen.getByRole("button", { name: "Back to live" }));
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    const rows = await screen.findAllByRole("button", { name: /after tag v/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("after tag v1 → HEAD");
  });

  it("opening a saved copy shows its exact text read-only with a banner and locks the live controls", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));

    const box = screen.getByLabelText("Release notes text") as HTMLTextAreaElement;
    expect(box.value).toBe("- old <b>note</b> & more");
    expect(box.readOnly).toBe(true);
    expect(screen.getByText(/Saved copy from/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Swap" })).toBeDisabled();
    expect(screen.getByLabelText("Dates")).toBeDisabled();
  });

  it("copying a saved copy does not create a new history entry", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(copyRich).toHaveBeenCalledWith("<ul><li>old &lt;b&gt;note&lt;/b&gt; &amp; more</li></ul>", "- old <b>note</b> & more"));
    expect(tauri.invokeAddReleaseNote).not.toHaveBeenCalled();
  });

  it("Back to live returns to the generated notes", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back to live" }));
    const box = screen.getByLabelText("Release notes text") as HTMLTextAreaElement;
    expect(box.value).toBe(LIVE);
    expect(box.readOnly).toBe(false);
  });

  it("Delete removes the saved copy and returns to the list", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(tauri.invokeDeleteReleaseNote).toHaveBeenCalledWith(7));
    expect(await screen.findByText(/Nothing saved yet/i)).toBeTruthy();
  });

  it("Escape steps back (saved copy → list → live) before closing the dialog", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved()]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: /after tag v0/ })).toBeTruthy(); // back at the list
    fireEvent.keyDown(window, { key: "Escape" });
    expect((screen.getByLabelText("Release notes text") as HTMLTextAreaElement).value).toBe(LIVE);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cannot copy or save the previous range's notes while a new range is still loading", async () => {
    const box = await openDialog();
    fireEvent.change(box, { target: { value: "- hand edit of the OLD range" } });

    let resolveNext!: (v: { oid: string; subject: string; timestamp: number }[]) => void;
    vi.mocked(tauri.invokeReleaseNotesCommits).mockReturnValue(new Promise((r) => (resolveNext = r)));
    act(() => useReleaseNotesStore.getState().markTo({ oid: "t2", label: "other tip", timestamp: 300 }));

    await waitFor(() => expect((screen.getByLabelText("Release notes text") as HTMLTextAreaElement).value).toBe(""));
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Release notes text"), { key: "Enter", metaKey: true });
    expect(copyRich).not.toHaveBeenCalled();
    expect(tauri.invokeAddReleaseNote).not.toHaveBeenCalled();

    resolveNext([{ oid: "b", subject: "CEM-2 | two (#2)", timestamp: Math.floor(new Date("2026-10-05T12:00:00").getTime() / 1000) }]);
    await waitFor(() => expect((screen.getByLabelText("Release notes text") as HTMLTextAreaElement).value).toContain("CEM-2"));
    expect((screen.getByLabelText("Release notes text") as HTMLTextAreaElement).value).not.toContain("OLD range");
  });

  it("does not copy or save whitespace-only text", async () => {
    const box = await openDialog();
    fireEvent.change(box, { target: { value: "  \n  " } });
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(copyRich).not.toHaveBeenCalled();
    expect(tauri.invokeAddReleaseNote).not.toHaveBeenCalled();
  });

  it("a saved copy names its own range, not the live one", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved({ fromLabel: "tag v0", toLabel: "tag v1" })]);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /after tag v0/ }));
    expect(screen.getByText(/Saved copy from/)).toHaveTextContent("after tag v0 → tag v1");
  });

  it("shows an inline message when the history cannot be loaded", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockRejectedValue("db locked");
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText(/Couldn't load history/i)).toBeTruthy();
  });
});

describe("releaseNotesHistoryStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReleaseNotesHistoryStore.setState({ byRepo: {} });
  });

  it("add puts the entry first and replaces an entry it de-duplicated into", async () => {
    vi.mocked(tauri.invokeListReleaseNotes).mockResolvedValue([saved({ id: 1, text: "x" })]);
    await useReleaseNotesHistoryStore.getState().load("/r");
    vi.mocked(tauri.invokeAddReleaseNote).mockResolvedValue(saved({ id: 1, text: "x", createdAt: 5 }));
    await useReleaseNotesHistoryStore.getState().add("/r", "a", "b", "x");
    const list = useReleaseNotesHistoryStore.getState().byRepo["/r"];
    expect(list).toHaveLength(1);
    expect(list[0].createdAt).toBe(5);
  });

  it("remove drops the entry from that repo only", async () => {
    vi.mocked(tauri.invokeDeleteReleaseNote).mockResolvedValue(undefined);
    useReleaseNotesHistoryStore.setState({ byRepo: { "/r": [saved({ id: 1 }), saved({ id: 2 })], "/o": [saved({ id: 3 })] } });
    await useReleaseNotesHistoryStore.getState().remove("/r", 1);
    expect(useReleaseNotesHistoryStore.getState().byRepo["/r"].map((e) => e.id)).toEqual([2]);
    expect(useReleaseNotesHistoryStore.getState().byRepo["/o"]).toHaveLength(1);
  });
});
