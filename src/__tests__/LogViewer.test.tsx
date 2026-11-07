import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LogViewer from "../components/LogViewer";
import * as tauri from "../lib/tauri";

vi.mock("../lib/tauri", () => ({ invokeCiJobLog: vi.fn() }));
vi.mock("../lib/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(true) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

const job = (steps: any[]) => ({ jobId: 5, name: "test", status: "completed", conclusion: "failure", startedAt: null, completedAt: null, url: "", steps });
const run = { runId: 1, workflowId: 1, workflowName: "CI", status: "completed", conclusion: "failure", url: "", startedAt: null, updatedAt: null, jobs: [] } as any;
const LOG = "test\tSet up job\t2026-09-30T10:00:00Z ok\ntest\tRun tests\t2026-09-30T10:00:01Z \u001b[31mFAIL\u001b[0m here\n";

describe("LogViewer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the log, opens the failed step and renders ANSI text", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValue({ text: LOG, truncated: false });
    render(<LogViewer repoPath="/r" job={job([{ number: 1, name: "Set up job", status: "completed", conclusion: "success" }, { number: 2, name: "Run tests", status: "completed", conclusion: "failure" }])} run={run} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("FAIL")).toBeInTheDocument());
    expect(screen.getByText("Run tests").closest("[data-open]")).toHaveAttribute("data-open", "true");
    expect(screen.getByText("Set up job").closest("[data-open]")).toHaveAttribute("data-open", "false");
  });

  it("opens at the top when no failed step is recorded", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValue({ text: LOG, truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Set up job")).toBeInTheDocument());
    expect(screen.getByText("Set up job").closest("[data-open]")).toHaveAttribute("data-open", "true");
    expect(screen.getByText("Run tests").closest("[data-open]")).toHaveAttribute("data-open", "false");
  });

  it("searches and highlights matches with a count", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValue({ text: LOG, truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("Set up job"));
    fireEvent.change(screen.getByPlaceholderText("Search log"), { target: { value: "here" } });
    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(document.querySelector("mark")).toHaveTextContent("here");
  });

  it("treats regex characters in the search literally and is case-insensitive", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValue({ text: "test\tbuild\t2026-09-30T10:00:00Z a(b[c OK ok\n", truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("build"));
    const input = screen.getByPlaceholderText("Search log");
    fireEvent.change(input, { target: { value: "(" } });
    expect(screen.getByText("1 match")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "[" } });
    expect(screen.getByText("1 match")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "ok" } });
    expect(screen.getByText("2 matches")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    expect(document.querySelector("mark")).toBeNull();
  });

  it("Enter and Shift+Enter step through matches and wrap around", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValue({ text: "test\tbuild\t2026-09-30T10:00:00Z ok one\ntest\tbuild\t2026-09-30T10:00:01Z ok two\n", truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("build"));
    const input = screen.getByPlaceholderText("Search log");
    fireEvent.change(input, { target: { value: "ok" } });
    const current = () => Array.from(document.querySelectorAll("mark")).findIndex((m) => m.getAttribute("data-current") === "true");
    expect(current()).toBe(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(current()).toBe(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(current()).toBe(0);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(current()).toBe(1);
  });

  it("does not crash on malformed ANSI sequences", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValue({ text: "test\tbuild\t2026-09-30T10:00:00Z bad \u001b[31 trailing \u001b\n", truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    expect(await screen.findByText(/bad/)).toBeInTheDocument();
  });

  it("offers to load the full log when truncated", async () => {
    (tauri.invokeCiJobLog as any).mockResolvedValueOnce({ text: LOG, truncated: true }).mockResolvedValueOnce({ text: LOG, truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText("Load full log"));
    await waitFor(() => expect(tauri.invokeCiJobLog).toHaveBeenLastCalledWith("/r", 5, true));
    await waitFor(() => expect(screen.queryByText("Load full log")).not.toBeInTheDocument());
  });

  it("shows an error state with retry when loading fails, and Esc closes", async () => {
    (tauri.invokeCiJobLog as any).mockRejectedValue("boom");
    const onClose = vi.fn();
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={onClose} />);
    expect(await screen.findByText("Couldn't load log")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Retry reloads after a failure", async () => {
    (tauri.invokeCiJobLog as any).mockRejectedValueOnce("boom").mockResolvedValueOnce({ text: LOG, truncated: false });
    render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Set up job")).toBeInTheDocument();
  });

  it("ignores a log response that arrives after unmount", async () => {
    let resolve: (v: any) => void = () => {};
    (tauri.invokeCiJobLog as any).mockReturnValue(new Promise((r) => (resolve = r)));
    const { unmount } = render(<LogViewer repoPath="/r" job={job([])} run={run} onClose={vi.fn()} />);
    unmount();
    resolve({ text: LOG, truncated: false });
    await Promise.resolve();
  });
});
