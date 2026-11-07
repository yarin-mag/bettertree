import { useReleaseNotesStore, type ReleaseNotesEnd } from "../store/releaseNotesStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { DEFAULT_REPO_SETTINGS, compileTicketPattern } from "./repoSettings";

export interface ReleaseNoteCommit {
  oid: string;
  subject: string;
  timestamp: number;
}

export interface FormatOptions {
  dates?: boolean;
  prNumbers?: boolean;
  /** Turn ticket ids into markdown links to their Jira issue. */
  jiraLinks?: boolean;
  /** Regex source for a ticket id; defaults to the repo default. */
  ticketPattern?: string;
  jiraBaseUrl?: string;
}

function linkTickets(subject: string, ticketPattern: string, jiraBaseUrl: string): string {
  const re = compileTicketPattern(ticketPattern);
  const base = jiraBaseUrl.trim();
  if (!re || !base) return subject;
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return subject.replace(re, (id) => `[${id}](${prefix}${id})`);
}

function day(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/** One `- <subject>, dd/mm` line per commit, in the order given. */
export function formatReleaseNotes(
  commits: ReleaseNoteCommit[],
  {
    dates = true,
    prNumbers = true,
    jiraLinks = false,
    ticketPattern = DEFAULT_REPO_SETTINGS.ticketPattern,
    jiraBaseUrl = DEFAULT_REPO_SETTINGS.jiraBaseUrl,
  }: FormatOptions = {}
): string {
  return commits
    .map((c) => {
      const stripped = prNumbers ? c.subject : c.subject.replace(/\s*\(#\d+\)\s*$/, "");
      const subject = jiraLinks ? linkTickets(stripped, ticketPattern, jiraBaseUrl) : stripped;
      return dates ? `- ${subject}, ${day(c.timestamp)}` : `- ${subject}`;
    })
    .join("\n");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * HTML twin of the list text, for pasting into rich editors such as Slack:
 * `- ` lines become one bullet list and `[text](url)` becomes a link.
 */
export function releaseNotesToHtml(text: string): string {
  const link = (line: string) =>
    escapeHtml(line).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  let html = "";
  let inList = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const item = /^- (.*)$/.exec(line);
    if (item) {
      html += `${inList ? "" : "<ul>"}<li>${link(item[1])}</li>`;
      inList = true;
    } else {
      html += `${inList ? "</ul>" : ""}<p>${link(line)}</p>`;
      inList = false;
    }
  }
  return html + (inList ? "</ul>" : "");
}

/** The range end for a graph row; a tag on the commit makes a better label than its summary. */
export function releaseNotesEnd(
  commit: { oid: string; summary: string; timestamp: number },
  tags: string[] = []
): ReleaseNotesEnd {
  return {
    oid: commit.oid,
    label: tags[0] ?? `${commit.oid.slice(0, 7)} ${commit.summary}`,
    timestamp: commit.timestamp,
  };
}

/** The checked-out commit as a range end, resolved by the backend from "HEAD". */
export function headEnd(): ReleaseNotesEnd {
  const head = useWorkspaceStore.getState().branches.find((b) => b.isHead);
  return { oid: "HEAD", label: head ? `HEAD (${head.name})` : "HEAD" };
}

/** Everything after `tag` up to the current HEAD, with the dialog opening right away. */
export function releaseNotesSinceTag(tag: { name: string; targetOid: string }): void {
  useReleaseNotesStore.getState().startRange({ oid: tag.targetOid, label: tag.name }, headEnd());
}
