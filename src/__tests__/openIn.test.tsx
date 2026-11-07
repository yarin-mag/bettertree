import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/tauri", async (orig) => ({
  ...(await orig<typeof import("../lib/tauri")>()),
  invokeListRepos: vi.fn().mockResolvedValue([]),
  invokeListOpenTargets: vi.fn(),
  invokeOpenIn: vi.fn(),
}));
vi.mock("../lib/branchActions", () => ({ copyWithToast: vi.fn(), checkoutBranch: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import * as tauri from "../lib/tauri";
import { copyWithToast } from "../lib/branchActions";
import { useOpenTargetsStore } from "../store/openTargetsStore";
import { buildOpenInItems } from "../lib/openIn";
import { useToastStore } from "../store/toastStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useRecentReposStore } from "../store/recentReposStore";
import RepoList from "../components/RepoList";

const targets = [
  { id: "vscode", label: "VS Code" },
  { id: "cursor", label: "Cursor" },
  { id: "finder", label: "Finder" },
];

describe("openTargetsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOpenTargetsStore.setState({ byPath: {} });
  });

  it("loads once per path and caches", async () => {
    vi.mocked(tauri.invokeListOpenTargets).mockResolvedValue(targets);
    await useOpenTargetsStore.getState().load("/r");
    await useOpenTargetsStore.getState().load("/r");
    expect(tauri.invokeListOpenTargets).toHaveBeenCalledTimes(1);
    expect(useOpenTargetsStore.getState().byPath["/r"]).toEqual(targets);
  });

  it("caches an empty list when detection fails, so the menu still offers Copy path", async () => {
    vi.mocked(tauri.invokeListOpenTargets).mockRejectedValue("boom");
    await useOpenTargetsStore.getState().load("/r");
    expect(useOpenTargetsStore.getState().byPath["/r"]).toEqual([]);
  });
});

describe("buildOpenInItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    vi.mocked(tauri.invokeOpenIn).mockResolvedValue(undefined);
  });

  it("labels apps 'Open in …', Finder 'Reveal in Finder', and ends with Copy path", () => {
    const items = buildOpenInItems("/r", targets);
    expect(items.map((i) => i.label)).toEqual(["Open in VS Code", "Open in Cursor", "Reveal in Finder", "Copy path"]);
  });

  it("offers just Copy path when nothing was detected", () => {
    expect(buildOpenInItems("/r", []).map((i) => i.label)).toEqual(["Copy path"]);
  });

  it("selecting an app opens the repo in it", () => {
    buildOpenInItems("/r", targets)[1].onSelect();
    expect(tauri.invokeOpenIn).toHaveBeenCalledWith("cursor", "/r");
  });

  it("toasts the reason when opening fails", async () => {
    vi.mocked(tauri.invokeOpenIn).mockRejectedValue("app not found");
    buildOpenInItems("/r", targets)[0].onSelect();
    await waitFor(() => expect(useToastStore.getState().toasts[0].message).toBe("Couldn't open in VS Code: app not found"));
  });

  it("Copy path copies the path", () => {
    buildOpenInItems("/r", targets).at(-1)!.onSelect();
    expect(copyWithToast).toHaveBeenCalledWith("/r", "path");
  });
});

describe("repo list menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useRecentReposStore.setState({ recentlyClosed: [] });
    useOpenTargetsStore.setState({ byPath: {} });
    vi.mocked(tauri.invokeListOpenTargets).mockResolvedValue(targets);
    vi.mocked(tauri.invokeOpenIn).mockResolvedValue(undefined);
    const repos = [{ id: 1, path: "/tmp/a", name: "a", pinned: false }];
    vi.mocked(tauri.invokeListRepos).mockResolvedValue(repos);
    useWorkspaceStore.setState({ repos, activeRepoId: 1 } as never);
  });

  it("detects the available apps for each repo when the list is shown", async () => {
    render(<RepoList />);
    await waitFor(() => expect(tauri.invokeListOpenTargets).toHaveBeenCalledWith("/tmp/a"));
  });

  it("right-click offers settings, then the open-in choices", async () => {
    render(<RepoList />);
    await waitFor(() => expect(useOpenTargetsStore.getState().byPath["/tmp/a"]).toBeDefined());

    fireEvent.contextMenu(screen.getByText("a"));

    const labels = screen.getAllByRole("menuitem").map((e) => e.textContent);
    expect(labels).toEqual(["Repo settings…", "Open in VS Code", "Open in Cursor", "Reveal in Finder", "Copy path"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Cursor" }));
    expect(tauri.invokeOpenIn).toHaveBeenCalledWith("cursor", "/tmp/a");
  });

  it("still offers Copy path before detection has finished", () => {
    vi.mocked(tauri.invokeListOpenTargets).mockReturnValue(new Promise(() => {}));
    render(<RepoList />);
    fireEvent.contextMenu(screen.getByText("a"));
    expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeInTheDocument();
  });
});
