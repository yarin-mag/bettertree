import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useSearchStore } from "../store/searchStore";
import { useViewStore } from "../store/viewStore";
import { useWorkspaceStore } from "../store/workspaceStore";

vi.mock("../components/RepoList", () => ({ default: () => <div data-testid="repo-list" /> }));
vi.mock("../components/BranchTree", () => ({ default: () => <div data-testid="branch-tree" /> }));

const resizable = vi.hoisted(() => ({ size: 340, hook: vi.fn() }));
vi.mock("../hooks/useResizable", () => ({ useResizable: resizable.hook }));

import Sidebar from "../components/Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    useSearchStore.setState({ isSearchActive: false });
    useViewStore.setState({ activeView: "repo" });
    resizable.size = 340;
    resizable.hook.mockImplementation(() => ({ size: resizable.size, onMouseDown: () => {} }));
  });

  it("shows the Bettertree logo and name above the tabs", () => {
    render(<Sidebar />);
    expect(screen.getByRole("img", { name: "Bettertree" })).toBeInTheDocument();
    expect(screen.getByText("Bettertree")).toBeInTheDocument();
  });

  it("keeps only the logo when the sidebar is compact", () => {
    resizable.size = 220;
    render(<Sidebar />);
    expect(screen.getByRole("img", { name: "Bettertree" })).toBeInTheDocument();
    expect(screen.queryByText("Bettertree")).not.toBeInTheDocument();
  });

  it("opens the settings modal from the settings store", async () => {
    const { useSettingsModalStore } = await import("../store/settingsModalStore");
    render(<Sidebar />);
    act(() => useSettingsModalStore.getState().open("/work/app"));
    expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
    act(() => useSettingsModalStore.getState().close());
  });

  it("defaults to 340px, resizable between 200 and 520", () => {
    const { container } = render(<Sidebar />);
    expect(resizable.hook).toHaveBeenCalledWith(340, 200, 520, "x");
    expect((container.firstChild as HTMLElement).style.width).toBe("340px");
  });

  it("renders icon + label tabs at wide widths", () => {
    resizable.size = 340;
    render(<Sidebar />);
    for (const label of ["Repo", "PRs", "Compare", "Actions"]) {
      const btn = screen.getByRole("button", { name: label });
      expect(btn).toHaveTextContent(label);
    }
  });

  it("renders icon-only tabs below the threshold, keeping accessible names and titles", () => {
    resizable.size = 300;
    render(<Sidebar />);
    for (const label of ["Repo", "PRs", "Compare", "Actions"]) {
      const btn = screen.getByRole("button", { name: label });
      expect(btn).toHaveAttribute("title", label);
      expect(btn).toHaveAttribute("aria-label", label);
      expect(btn).not.toHaveTextContent(label);
      expect(btn.className).toContain("flex-1");
      expect(btn.className).toContain("min-w-0");
    }
  });

  it("compact tabs still switch the view", () => {
    resizable.size = 200;
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(useViewStore.getState().activeView).toBe("compare");
  });

  it("does not render the AdvancedSearch panel inline", () => {
    render(<Sidebar />);
    expect(screen.queryByPlaceholderText("Message or code...")).not.toBeInTheDocument();
  });

  it("switches the view store to pulls when the PRs tab is clicked", () => {
    render(<Sidebar />);
    screen.getByRole("button", { name: "PRs" }).click();
    expect(useViewStore.getState().activeView).toBe("pulls");
  });

  it("switches back to repo when the Repo tab is clicked", () => {
    useViewStore.setState({ activeView: "pulls" });
    render(<Sidebar />);
    screen.getByRole("button", { name: "Repo" }).click();
    expect(useViewStore.getState().activeView).toBe("repo");
  });

  it("switches to compare when the Compare tab is clicked", () => {
    render(<Sidebar />);
    screen.getByRole("button", { name: "Compare" }).click();
    expect(useViewStore.getState().activeView).toBe("compare");
  });

  it("switches to actions when the Actions tab is clicked", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(useViewStore.getState().activeView).toBe("actions");
  });

  it("shows the active repo path and a settings button in the sidebar footer", () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/repo-a", name: "repo-a", pinned: false }],
      activeRepoId: 1,
    });
    render(<Sidebar />);
    expect(screen.getByText("/tmp/repo-a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeInTheDocument();
  });

  it("opens the settings modal when the settings button is clicked", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.getByText("Theme")).toBeInTheDocument();
  });
});
