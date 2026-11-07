import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSearchStore } from "../store/searchStore";
import SearchBar from "../components/SearchBar";

describe("SearchBar", () => {
  beforeEach(() => {
    useSearchStore.setState({ query: "", isSearchActive: false });
  });

  it("renders the live-filter input", () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText("Search branches, tags, commits...")).toBeInTheDocument();
  });

  it("updates the live-filter query as the user types", () => {
    render(<SearchBar />);
    fireEvent.change(screen.getByPlaceholderText("Search branches, tags, commits..."), {
      target: { value: "main" },
    });
    expect(useSearchStore.getState().query).toBe("main");
  });

  it("activates commit-history search when the history button is clicked", () => {
    render(<SearchBar />);
    fireEvent.click(screen.getByRole("button", { name: "Search commit history" }));
    expect(useSearchStore.getState().isSearchActive).toBe(true);
  });
});
