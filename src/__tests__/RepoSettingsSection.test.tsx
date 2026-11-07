import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeGetRepoSettings: vi.fn(),
  invokeSetRepoSettings: vi.fn(),
  invokeResetRepoSettings: vi.fn(),
}));

import * as tauri from "../lib/tauri";
import { DEFAULT_REPO_SETTINGS } from "../lib/repoSettings";
import { useRepoSettingsStore } from "../store/repoSettingsStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSettingsModalStore } from "../store/settingsModalStore";
import RepoSettingsSection from "../components/RepoSettingsSection";

describe("settingsModalStore", () => {
  it("opens with an optional preselected repo and closes", () => {
    useSettingsModalStore.getState().open("/r");
    expect(useSettingsModalStore.getState()).toMatchObject({ isOpen: true, repoPath: "/r" });
    useSettingsModalStore.getState().close();
    expect(useSettingsModalStore.getState()).toMatchObject({ isOpen: false, repoPath: null });
    useSettingsModalStore.getState().open();
    expect(useSettingsModalStore.getState()).toMatchObject({ isOpen: true, repoPath: null });
  });
});

describe("RepoSettingsSection", () => {
  const other = { ticketPattern: "ABC-\\d+", jiraBaseUrl: "https://j.example.com/browse/", worktreeDir: "/wt", releaseTagPattern: "rel-*" };

  beforeEach(() => {
    vi.clearAllMocks();
    useRepoSettingsStore.setState({ byPath: {} });
    useWorkspaceStore.setState({
      repos: [
        { id: 1, path: "/work/app", name: "app", pinned: false },
        { id: 2, path: "/work/other", name: "other", pinned: false },
      ],
      activeRepoId: 1,
    } as never);
    vi.mocked(tauri.invokeGetRepoSettings).mockImplementation(async (p) =>
      p === "/work/other" ? other : DEFAULT_REPO_SETTINGS
    );
    vi.mocked(tauri.invokeSetRepoSettings).mockImplementation(async (_p, s) => s);
    vi.mocked(tauri.invokeResetRepoSettings).mockResolvedValue(undefined);
  });

  it("shows the preselected repo's settings in the form", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/other" />);
    await waitFor(() => expect((screen.getByLabelText("Ticket pattern") as HTMLInputElement).value).toBe("ABC-\\d+"));
    expect((screen.getByLabelText("Repository") as HTMLSelectElement).value).toBe("/work/other");
    expect((screen.getByLabelText("Jira base URL") as HTMLInputElement).value).toBe("https://j.example.com/browse/");
    expect((screen.getByLabelText("Worktree folder") as HTMLInputElement).value).toBe("/wt");
  });

  it("disables the form until the picked repo's settings have loaded, then fills it", async () => {
    let resolveOther!: (v: typeof other) => void;
    vi.mocked(tauri.invokeGetRepoSettings).mockImplementation((p) =>
      p === "/work/other" ? new Promise((r) => (resolveOther = r)) : Promise.resolve(DEFAULT_REPO_SETTINGS)
    );
    render(<RepoSettingsSection initialRepoPath="/work/app" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "/work/other" } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByLabelText("Ticket pattern")).toBeDisabled();
    resolveOther(other);
    await waitFor(() => expect(screen.getByLabelText("Ticket pattern")).toHaveProperty("value", "ABC-\\d+"));
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    expect(tauri.invokeSetRepoSettings).not.toHaveBeenCalled();
  });

  it("edits the release tag pattern, with a hint about the empty default", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/other" />);
    await waitFor(() => expect(screen.getByLabelText("Release tag pattern")).toHaveProperty("value", "rel-*"));
    expect(screen.getByText(/Empty = any tag/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Release tag pattern"), { target: { value: "beta-*" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(tauri.invokeSetRepoSettings).toHaveBeenCalledWith("/work/other", { ...other, releaseTagPattern: "beta-*" })
    );
  });

  it("falls back to the first repo when none is preselected", async () => {
    render(<RepoSettingsSection />);
    expect((screen.getByLabelText("Repository") as HTMLSelectElement).value).toBe("/work/app");
  });

  it("saves to the repo picked in the dropdown, not the active one", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/app" />);
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "/work/other" } });
    await waitFor(() => expect((screen.getByLabelText("Ticket pattern") as HTMLInputElement).value).toBe("ABC-\\d+"));

    fireEvent.change(screen.getByLabelText("Ticket pattern"), { target: { value: "XYZ-\\d+" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(tauri.invokeSetRepoSettings).toHaveBeenCalledWith("/work/other", { ...other, ticketPattern: "XYZ-\\d+" })
    );
  });

  it("shows the normalized value the backend stored after saving", async () => {
    vi.mocked(tauri.invokeSetRepoSettings).mockImplementation(async (_p, s) => ({
      ...s,
      jiraBaseUrl: s.jiraBaseUrl + "/",
    }));
    render(<RepoSettingsSection initialRepoPath="/work/app" />);
    await waitFor(() => expect(screen.getByLabelText("Jira base URL")).toHaveProperty("value", DEFAULT_REPO_SETTINGS.jiraBaseUrl));

    fireEvent.change(screen.getByLabelText("Jira base URL"), { target: { value: "https://j.example.com/browse" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByLabelText("Jira base URL")).toHaveProperty("value", "https://j.example.com/browse/"));
  });

  it("blocks saving an invalid ticket pattern and says why", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/app" />);
    await waitFor(() => expect(screen.getByLabelText("Ticket pattern")).toHaveProperty("value", "CEM-\\d+"));

    fireEvent.change(screen.getByLabelText("Ticket pattern"), { target: { value: "CEM-(" } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Invalid|Unterminated|regular expression/i)).toBeTruthy();
  });

  it("shows a backend save error inline and keeps the form", async () => {
    vi.mocked(tauri.invokeSetRepoSettings).mockRejectedValue("Jira base URL must start with http:// or https://");
    render(<RepoSettingsSection initialRepoPath="/work/app" />);
    await waitFor(() => expect(screen.getByLabelText("Jira base URL")).toHaveProperty("value", DEFAULT_REPO_SETTINGS.jiraBaseUrl));

    fireEvent.change(screen.getByLabelText("Jira base URL"), { target: { value: "ftp://x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Jira base URL must start with http:// or https://")).toBeTruthy();
    expect(screen.getByLabelText("Jira base URL")).toHaveProperty("value", "ftp://x");
  });

  it("Reset to defaults clears the stored settings and refills the form", async () => {
    render(<RepoSettingsSection initialRepoPath="/work/other" />);
    await waitFor(() => expect(screen.getByLabelText("Ticket pattern")).toHaveProperty("value", "ABC-\\d+"));

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    await waitFor(() => expect(tauri.invokeResetRepoSettings).toHaveBeenCalledWith("/work/other"));
    await waitFor(() => expect(screen.getByLabelText("Ticket pattern")).toHaveProperty("value", DEFAULT_REPO_SETTINGS.ticketPattern));
  });

  it("asks you to add a repo when there are none", () => {
    useWorkspaceStore.setState({ repos: [], activeRepoId: null } as never);
    render(<RepoSettingsSection />);
    expect(screen.getByText(/Add a repository/i)).toBeTruthy();
    expect(screen.queryByLabelText("Ticket pattern")).toBeNull();
  });
});
