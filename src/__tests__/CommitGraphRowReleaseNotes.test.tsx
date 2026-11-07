import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CommitGraphRow from "../components/CommitGraphRow";
import { useReleaseNotesStore } from "../store/releaseNotesStore";

const commit = {
  oid: "abcdef1234567",
  summary: "CEM-1 | thing (#1)",
  author: "A",
  timestamp: 1000,
  lane: 0,
  edges: [],
  activeLanes: [true],
};

function openMenu() {
  render(<CommitGraphRow commit={commit} showGraphLines={false} />);
  fireEvent.contextMenu(screen.getByTestId("commit-row"));
}

describe("CommitGraphRow release notes menu", () => {
  beforeEach(() => useReleaseNotesStore.getState().clear());

  it("marks the commit as the start of the range", () => {
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Release notes: from here" }));
    expect(useReleaseNotesStore.getState().from).toMatchObject({ oid: "abcdef1234567", timestamp: 1000 });
  });

  it("marks the commit as the end of the range", () => {
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Release notes: to here" }));
    expect(useReleaseNotesStore.getState().to).toMatchObject({ oid: "abcdef1234567" });
  });

  it("shows a marker on a row that is a range end", () => {
    useReleaseNotesStore.getState().markFrom({ oid: commit.oid, label: "x", timestamp: 1000 });
    render(<CommitGraphRow commit={commit} showGraphLines={false} />);
    expect(screen.getByLabelText("Release notes start")).toBeTruthy();
  });
});
