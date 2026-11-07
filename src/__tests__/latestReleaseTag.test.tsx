import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeLatestReleaseTag: vi.fn(),
  invokeGetRepoSettings: vi.fn(),
}));

import * as tauri from "../lib/tauri";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import { releaseNotesSinceLatestTag } from "../lib/latestReleaseTag";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";
import BranchTree from "../components/BranchTree";
import CommandPalette from "../components/CommandPalette";

const tag = { name: "beta-ota-378", oid: "abc123", timestamp: 1000 };

function seed() {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  useReleaseNotesStore.getState().clear();
  useRepoSettingsStore.setState({ byPath: {} });
  vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue({ ...DEFAULT_REPO_SETTINGS, releaseTagPattern: "beta-*" });
  vi.mocked(tauri.invokeLatestReleaseTag).mockResolvedValue(tag);
  useWorkspaceStore.setState({
    repos: [{ id: 1, path: "/r", name: "r", pinned: false }],
    activeRepoId: 1,
    branches: [{ name: "release-379", isRemote: false, isHead: true, targetOid: "h" }],
    tags: [{ name: "beta-ota-378", targetOid: "abc123" }],
    commits: [],
  } as never);
}

describe("releaseNotesSinceLatestTag", () => {
  beforeEach(seed);

  it("looks the tag up with the repo's pattern and opens the range tag → HEAD", async () => {
    await releaseNotesSinceLatestTag();
    expect(tauri.invokeLatestReleaseTag).toHaveBeenCalledWith("/r", "beta-*");
    const s = useReleaseNotesStore.getState();
    expect(s.from).toMatchObject({ oid: "abc123", label: "beta-ota-378" });
    expect(s.to).toMatchObject({ oid: "HEAD", label: "HEAD (release-379)" });
  });

  it("says so when no tag matches the pattern, and opens nothing", async () => {
    vi.mocked(tauri.invokeLatestReleaseTag).mockResolvedValue(null);
    await releaseNotesSinceLatestTag();
    expect(useReleaseNotesStore.getState().from).toBeNull();
    expect(useToastStore.getState().toasts[0].message).toBe('No tag matching "beta-*" reachable from HEAD');
  });

  it("uses a different message when the pattern is empty", async () => {
    vi.mocked(tauri.invokeGetRepoSettings).mockResolvedValue(DEFAULT_REPO_SETTINGS);
    vi.mocked(tauri.invokeLatestReleaseTag).mockResolvedValue(null);
    await releaseNotesSinceLatestTag();
    expect(useToastStore.getState().toasts[0].message).toBe("No tags reachable from HEAD");
  });

  it("toasts an error when the lookup fails", async () => {
    vi.mocked(tauri.invokeLatestReleaseTag).mockRejectedValue("repo unreadable");
    await releaseNotesSinceLatestTag();
    expect(useReleaseNotesStore.getState().from).toBeNull();
    expect(useToastStore.getState().toasts[0].message).toContain("repo unreadable");
  });

  it("does nothing without an active repo", async () => {
    useWorkspaceStore.setState({ activeRepoId: null } as never);
    await releaseNotesSinceLatestTag();
    expect(tauri.invokeLatestReleaseTag).not.toHaveBeenCalled();
  });
});

describe("entry points", () => {
  beforeEach(seed);

  it("the TAGS header has a button that runs the flow", async () => {
    render(<BranchTree />);
    fireEvent.click(screen.getByRole("button", { name: "Release notes since latest release tag" }));
    await waitFor(() => expect(useReleaseNotesStore.getState().from?.oid).toBe("abc123"));
  });

  it("the TAGS button is disabled without an active repo", () => {
    useWorkspaceStore.setState({ activeRepoId: null } as never);
    render(<BranchTree />);
    expect(screen.getByRole("button", { name: "Release notes since latest release tag" })).toBeDisabled();
  });

  it("the command palette lists it and running it starts the flow", async () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByText("Release notes since latest release tag"));
    await waitFor(() => expect(useReleaseNotesStore.getState().from?.oid).toBe("abc123"));
  });

  it("the palette hides it when no repo is active", async () => {
    useWorkspaceStore.setState({ activeRepoId: null } as never);
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByRole("textbox");
    expect(screen.queryByText("Release notes since latest release tag")).toBeNull();
  });
});
