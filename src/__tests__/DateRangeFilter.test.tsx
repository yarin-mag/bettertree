import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DateRangeFilter from "../components/DateRangeFilter";

describe("DateRangeFilter", () => {
  beforeEach(() => {
    // Fixed at noon UTC so the local calendar date is "2026-07-21" across
    // any realistic timezone offset (see Global Constraints on date math).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 'Any' when no value is set", () => {
    render(<DateRangeFilter value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("Any");
  });

  it("shows a range summary when both From and To are set", () => {
    render(<DateRangeFilter value="2026-07-01..2026-07-15" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("2026-07-01 → 2026-07-15");
  });

  it("shows a from-only summary", () => {
    render(<DateRangeFilter value=">=2026-07-01" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("From 2026-07-01");
  });

  it("shows a to-only summary", () => {
    render(<DateRangeFilter value="<=2026-07-15" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveTextContent("Until 2026-07-15");
  });

  it("clicking Today sets both From and To to today", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Today"));
    expect(onChange).toHaveBeenCalledWith("2026-07-21..2026-07-21");
  });

  it("clicking Last 7 days sets a 7-day range ending today", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Last 7 days"));
    expect(onChange).toHaveBeenCalledWith("2026-07-15..2026-07-21");
  });

  it("clicking Last 30 days sets a 30-day range ending today", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Last 30 days"));
    expect(onChange).toHaveBeenCalledWith("2026-06-22..2026-07-21");
  });

  it("clicking This month sets a range from the 1st of the month to today", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("This month"));
    expect(onChange).toHaveBeenCalledWith("2026-07-01..2026-07-21");
  });

  it("editing the From input calls onChange with a from-only value when To is empty", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-07-01" } });
    expect(onChange).toHaveBeenCalledWith(">=2026-07-01");
  });

  it("editing the To input calls onChange with a to-only value when From is empty", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-07-15" } });
    expect(onChange).toHaveBeenCalledWith("<=2026-07-15");
  });

  it("combines an existing From with a newly-set To into a range", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value=">=2026-07-01" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-07-15" } });
    expect(onChange).toHaveBeenCalledWith("2026-07-01..2026-07-15");
  });

  it("shows a Clear button when a value is set, which calls onChange(null)", () => {
    const onChange = vi.fn();
    render(<DateRangeFilter value="2026-07-01..2026-07-15" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows no Clear button when no value is set", () => {
    render(<DateRangeFilter value={undefined} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <DateRangeFilter value={undefined} onChange={vi.fn()} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Today")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
  });
});
