import { describe, it, expect, beforeEach } from "vitest";
import { formatReleaseNotes, releaseNotesToHtml } from "../lib/releaseNotes";
import { useReleaseNotesStore } from "../store/releaseNotesStore";

const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe("formatReleaseNotes", () => {
  it("formats one dash line per commit with dd/mm date, keeping the subject as written", () => {
    const out = formatReleaseNotes([
      { oid: "a", subject: "CEM-28901 | derive drawing id (#7192)", timestamp: ts("2026-10-04T12:00:00") },
      { oid: "b", subject: "CEM-28981 | add timeout (cherry-pick) (#7199)", timestamp: ts("2026-10-05T12:00:00") },
    ]);
    expect(out).toBe(
      "- CEM-28901 | derive drawing id (#7192), 04/10\n- CEM-28981 | add timeout (cherry-pick) (#7199), 05/10"
    );
  });

  it("can leave out the dates", () => {
    const out = formatReleaseNotes(
      [{ oid: "a", subject: "CEM-1 | thing (#1)", timestamp: ts("2026-10-04T12:00:00") }],
      { dates: false }
    );
    expect(out).toBe("- CEM-1 | thing (#1)");
  });

  it("can strip a trailing PR number but keeps other parentheses", () => {
    const out = formatReleaseNotes(
      [{ oid: "a", subject: "CEM-2 | add timeout (cherry-pick) (#7199)", timestamp: ts("2026-10-04T12:00:00") }],
      { prNumbers: false }
    );
    expect(out).toBe("- CEM-2 | add timeout (cherry-pick), 04/10");
  });

  it("turns every CEM ticket into a markdown link to Jira when asked", () => {
    const out = formatReleaseNotes(
      [{ oid: "a", subject: "CEM-28901 | fix, follow-up to CEM-28800 (#1)", timestamp: ts("2026-10-04T12:00:00") }],
      { jiraLinks: true, dates: false }
    );
    expect(out).toBe(
      "- [CEM-28901](https://cemento.atlassian.net/browse/CEM-28901) | fix, follow-up to [CEM-28800](https://cemento.atlassian.net/browse/CEM-28800) (#1)"
    );
  });

  it("leaves a ticket-less 'CEM-' prefix alone", () => {
    const out = formatReleaseNotes(
      [{ oid: "a", subject: "CEM- | skip version bump", timestamp: ts("2026-10-04T12:00:00") }],
      { jiraLinks: true, dates: false }
    );
    expect(out).toBe("- CEM- | skip version bump");
  });

  const sub = (subject: string) => [{ oid: "a", subject, timestamp: ts("2026-10-04T12:00:00") }];

  it("uses a custom ticket pattern and Jira URL (adding a missing trailing slash)", () => {
    const out = formatReleaseNotes(sub("ABC-12 | x, relates to CEM-5"), {
      jiraLinks: true,
      dates: false,
      ticketPattern: "ABC-\\d+",
      jiraBaseUrl: "https://jira.example.com/browse",
    });
    expect(out).toBe("- [ABC-12](https://jira.example.com/browse/ABC-12) | x, relates to CEM-5");
  });

  it("links every id when the pattern uses alternation", () => {
    const out = formatReleaseNotes(sub("CEM-1 and ABC-2"), {
      jiraLinks: true,
      dates: false,
      ticketPattern: "CEM-\\d+|ABC-\\d+",
      jiraBaseUrl: "https://j.example.com/",
    });
    expect(out).toBe("- [CEM-1](https://j.example.com/CEM-1) and [ABC-2](https://j.example.com/ABC-2)");
  });

  it("links the whole id even when the pattern has capture groups", () => {
    const out = formatReleaseNotes(sub("CEM-77 | y"), {
      jiraLinks: true,
      dates: false,
      ticketPattern: "(CEM)-(\\d+)",
      jiraBaseUrl: "https://j.example.com/",
    });
    expect(out).toBe("- [CEM-77](https://j.example.com/CEM-77) | y");
  });

  it("produces plain text, not an error, for an invalid stored pattern", () => {
    const out = formatReleaseNotes(sub("CEM-1 | y"), { jiraLinks: true, dates: false, ticketPattern: "CEM-(" });
    expect(out).toBe("- CEM-1 | y");
  });

  it("does not litter the text with links for a pattern that matches empty text", () => {
    const out = formatReleaseNotes(sub("fix CEM-1 now"), {
      jiraLinks: true,
      dates: false,
      ticketPattern: "CEM-\\d+|",
    });
    expect(out).toBe("- fix CEM-1 now");
  });

  it("produces plain text when the Jira URL is empty", () => {
    const out = formatReleaseNotes(sub("CEM-1 | y"), { jiraLinks: true, dates: false, jiraBaseUrl: "" });
    expect(out).toBe("- CEM-1 | y");
  });

  it("returns an empty string for no commits", () => {
    expect(formatReleaseNotes([])).toBe("");
  });
});

describe("releaseNotesStore", () => {
  const early = { oid: "e", label: "early", timestamp: 100 };
  const late = { oid: "l", label: "late", timestamp: 200 };
  beforeEach(() => useReleaseNotesStore.getState().clear());

  it("keeps from and to as marked when already in order", () => {
    useReleaseNotesStore.getState().markFrom(early);
    useReleaseNotesStore.getState().markTo(late);
    const s = useReleaseNotesStore.getState();
    expect([s.from?.oid, s.to?.oid]).toEqual(["e", "l"]);
  });

  it("swaps the ends when from is newer than to", () => {
    useReleaseNotesStore.getState().markFrom(late);
    useReleaseNotesStore.getState().markTo(early);
    const s = useReleaseNotesStore.getState();
    expect([s.from?.oid, s.to?.oid]).toEqual(["e", "l"]);
  });

  it("swap() exchanges the ends and clear() resets both", () => {
    useReleaseNotesStore.getState().markFrom(early);
    useReleaseNotesStore.getState().markTo(late);
    useReleaseNotesStore.getState().swap();
    expect(useReleaseNotesStore.getState().from?.oid).toBe("l");
    useReleaseNotesStore.getState().clear();
    expect(useReleaseNotesStore.getState().from).toBeNull();
    expect(useReleaseNotesStore.getState().to).toBeNull();
  });
});

describe("releaseNotesToHtml", () => {
  it("renders dash lines as one list with links", () => {
    const html = releaseNotesToHtml(
      "- [CEM-1](https://cemento.atlassian.net/browse/CEM-1) | one (#1), 04/10\n- plain line"
    );
    expect(html).toBe(
      '<ul><li><a href="https://cemento.atlassian.net/browse/CEM-1">CEM-1</a> | one (#1), 04/10</li><li>plain line</li></ul>'
    );
  });

  it("escapes HTML in the text", () => {
    expect(releaseNotesToHtml("- a <b>bold</b> & more")).toBe("<ul><li>a &lt;b&gt;bold&lt;/b&gt; &amp; more</li></ul>");
  });

  it("keeps non-list lines as paragraphs around the list", () => {
    expect(releaseNotesToHtml("Changes:\n- one")).toBe("<p>Changes:</p><ul><li>one</li></ul>");
  });
});
