import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EmptyState from "../components/EmptyState";
import { describeGithubUnavailable } from "../lib/githubUnavailable";

describe("EmptyState", () => {
  it("renders title, hint and fires the action", () => {
    const onClick = vi.fn();
    render(<EmptyState title="Nothing" hint="Add one" action={{ label: "Add", onClick }} />);
    expect(screen.getByText("Nothing")).toBeInTheDocument();
    expect(screen.getByText("Add one")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("error variant is an alert and exposes details", () => {
    render(<EmptyState variant="error" title="Broke" details="boom: stack" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("boom: stack")).toBeInTheDocument();
  });
});

describe("describeGithubUnavailable", () => {
  it("maps gh missing, unauthenticated and non-GitHub remote", () => {
    expect(describeGithubUnavailable("failed to run gh: No such file").hint).toContain("brew install gh");
    expect(describeGithubUnavailable("gh: not logged in", true).hint).toContain("gh auth login");
    expect(describeGithubUnavailable("origin remote is not a GitHub repository").title).toBe("Not a GitHub repository");
    expect(describeGithubUnavailable(null).title).toBe("GitHub unavailable");
  });
});
