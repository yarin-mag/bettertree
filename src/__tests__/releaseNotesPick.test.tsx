import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { useUiStore } from "../store/uiStore";
import { useReleaseNotesStore } from "../store/releaseNotesStore";
import { releaseNotesSinceTag } from "../lib/releaseNotes";
import CommitGraph from "../components/CommitGraph";
import BranchTree from "../components/BranchTree";

const mk = (oid: string, timestamp: number, summary = `sum ${oid}`) => ({
  oid,
  summary,
  author: "A",
  timestamp,
  lane: 0,
  edges: [],
  activeLanes: [true],
});

function seed() {
  useSearchStore.setState({ query: "" });
  useReleaseNotesStore.getState().clear();
  useUiStore.setState({ selectedCommitOid: null } as never);
  useWorkspaceStore.setState({
    hasMoreCommits: false,
    isLoadingMoreCommits: false,
    repos: [{ id: 1, path: "/r", name: "r", pinned: false }],
    activeRepoId: 1,
    branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "c4" }],
    tags: [{ name: "v1.0", targetOid: "c1" }],
    commits: [mk("c4", 400), mk("c3", 300), mk("c2", 200), mk("c1", 100)],
  } as never);
}

describe("release notes store without timestamps", () => {
  beforeEach(seed);

  it("does not reorder ends that carry no timestamp", () => {
    useReleaseNotesStore.getState().markFrom({ oid: "c1", label: "tag" });
    useReleaseNotesStore.getState().markTo({ oid: "HEAD", label: "HEAD (main)" });
    const s = useReleaseNotesStore.getState();
    expect([s.from?.oid, s.to?.oid]).toEqual(["c1", "HEAD"]);
  });

  it("releaseNotesSinceTag sets the tag as From and the current HEAD as To", () => {
    releaseNotesSinceTag({ name: "v1.0", targetOid: "c1" });
    const s = useReleaseNotesStore.getState();
    expect(s.from).toMatchObject({ oid: "c1", label: "v1.0" });
    expect(s.to).toMatchObject({ oid: "HEAD", label: "HEAD (main)" });
  });
});

describe("graph pick mode", () => {
  beforeEach(seed);

  it("shows no banner until one end is marked", () => {
    render(<CommitGraph />);
    expect(screen.queryByTestId("release-notes-pick-banner")).toBeNull();
  });

  it("left-clicking a commit after From sets To instead of selecting it", () => {
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getAllByTestId("commit-row")[3]); // c1
    fireEvent.click(screen.getByRole("menuitem", { name: "Release notes: from here" }));
    expect(screen.getByTestId("release-notes-pick-banner")).toHaveTextContent("click the last commit");

    fireEvent.click(screen.getAllByTestId("commit-row")[1]); // c3

    const s = useReleaseNotesStore.getState();
    expect([s.from?.oid, s.to?.oid]).toEqual(["c1", "c3"]);
    expect(useUiStore.getState().selectedCommitOid).toBeNull();
    expect(screen.queryByTestId("release-notes-pick-banner")).toBeNull();
  });

  it("left-clicking after To sets From", () => {
    render(<CommitGraph />);
    act(() => {
      useReleaseNotesStore.getState().markTo({ oid: "c4", label: "c4", timestamp: 400 });
    });
    expect(screen.getByTestId("release-notes-pick-banner")).toHaveTextContent("click the first commit");
    fireEvent.click(screen.getAllByTestId("commit-row")[3]);
    expect(useReleaseNotesStore.getState().from?.oid).toBe("c1");
  });

  it("'Up to HEAD' completes the range with HEAD", () => {
    render(<CommitGraph />);
    act(() => {
      useReleaseNotesStore.getState().markFrom({ oid: "c1", label: "tag", timestamp: 100 });
    });

    fireEvent.click(screen.getByRole("button", { name: "Up to HEAD" }));

    expect(useReleaseNotesStore.getState().to).toMatchObject({ oid: "HEAD", label: "HEAD (main)" });
  });

  it("Cancel and Escape leave pick mode", () => {
    render(<CommitGraph />);
    act(() => {
      useReleaseNotesStore.getState().markFrom({ oid: "c1", label: "tag", timestamp: 100 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useReleaseNotesStore.getState().from).toBeNull();

    act(() => {

      useReleaseNotesStore.getState().markFrom({ oid: "c1", label: "tag", timestamp: 100 });

    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useReleaseNotesStore.getState().from).toBeNull();
  });

  it("tints the rows between the marked end and the hovered row", () => {
    render(<CommitGraph />);
    act(() => {
      useReleaseNotesStore.getState().markFrom({ oid: "c1", label: "tag", timestamp: 100 });
    });
    const rows = screen.getAllByTestId("commit-row");

    fireEvent.mouseEnter(rows[1]); // hover c3

    expect(rows.map((r) => r.getAttribute("data-in-range"))).toEqual([null, "true", "true", "true"]);
  });

  it("normal clicks still select a commit when not picking", () => {
    render(<CommitGraph />);
    fireEvent.click(screen.getAllByTestId("commit-row")[0]);
    expect(useUiStore.getState().selectedCommitOid).toBe("c4");
  });
});

describe("tag shortcuts", () => {
  beforeEach(seed);

  it("sidebar tag menu starts a range from the tag to HEAD", () => {
    render(<BranchTree />);
    fireEvent.contextMenu(screen.getByText("v1.0"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Release notes since this tag" }));
    const s = useReleaseNotesStore.getState();
    expect([s.from?.oid, s.to?.oid]).toEqual(["c1", "HEAD"]);
  });

  it("graph row menu offers it for each tag on that commit", () => {
    useWorkspaceStore.setState({ tags: [{ name: "v1.0", targetOid: "c1" }] } as never);
    render(<CommitGraph />);
    fireEvent.contextMenu(screen.getAllByTestId("commit-row")[3]); // c1 carries v1.0
    fireEvent.click(screen.getByRole("menuitem", { name: "Release notes since v1.0" }));
    expect(useReleaseNotesStore.getState().from?.label).toBe("v1.0");
    expect(useReleaseNotesStore.getState().to?.oid).toBe("HEAD");
  });
});
