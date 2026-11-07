# Latest release tag button and release-notes history (P2a) — design

Date: 2026-10-08
Status: draft for review
Builds on: `2026-10-06-per-repo-settings-design.md` (per-repo settings), the release-notes dialog.

## Purpose

Writing release notes today means finding the previous release tag by hand,
marking it in the graph, then marking the end. And once the dialog closes, the
notes are gone. Add (1) a one-click "release notes since the latest release
tag" and (2) a saved history of notes the user actually copied.

Success: one click (or one palette command) opens the dialog with From = latest
matching tag reachable from HEAD and To = HEAD; and a note copied last week can
be reopened and copied again, exactly as it was sent.

## Scope

In: `releaseTagPattern` repo setting; `latest_release_tag` backend command; the
button and palette entry; history storage, dialog UI, and cap.

Out: pre-release checks (P2b); Jira titles and Slack sending (P2c); editing a
saved note in place; exporting history; history search.

## 1. Release tag pattern (extends per-repo settings)

New field on `RepoSettings` (Rust `release_tag_pattern`, TS `releaseTagPattern`,
camelCase on the wire): a glob (`*` and `?`), default empty string. Empty means
"any tag". Stored in the existing `repo_settings` table as a new column; existing
rows and "no row" both mean empty. The table is created with the column and
existing databases are upgraded with `ALTER TABLE ... ADD COLUMN ... DEFAULT ''`
(ignored if it already exists). Validation: none beyond trimming (any text is a
valid glob). The Settings form gets a "Release tag pattern" input with the hint
"e.g. beta-ota-v-mobile-*. Empty = any tag."

## 2. Latest release tag

Command `latest_release_tag(repo_path, pattern) -> Option<ReleaseTag>`,
`ReleaseTag { name, oid, timestamp }` (camelCase), `oid` = the tagged commit.

Rules:
- Candidate tags: `Repository::tag_names(pattern)` (libgit2 fnmatch); empty
  pattern = all tags.
- Each tag peels to a commit. A candidate is kept only if that commit is HEAD
  itself or an ancestor of HEAD. Tags that peel to non-commits are skipped.
- Date: annotated tag -> tagger time (falls back to commit time if no tagger);
  lightweight tag -> commit time.
- Winner: newest date; ties broken by the lexicographically greater tag name.
- Detached HEAD works the same. An unborn HEAD returns `None`.
- No match returns `None`.

## 3. The button and palette entry

- Sidebar TAGS header: an icon button, label "Release notes since latest release tag".
- Command palette: entry with the same label.
- Both call `releaseNotesSinceLatestTag()`: load the repo's settings, invoke
  `latest_release_tag`, then `useReleaseNotesStore.startRange({oid, label: name}, headEnd())`.
  On `None`: toast `No tag matching "<pattern>" reachable from HEAD` (or
  `No tags reachable from HEAD` when the pattern is empty). On error: error toast.
- When HEAD is exactly the tagged commit the dialog still opens and shows "0 commits".
- No active repo: the button and palette entry do nothing.

## 4. History

Storage: SQLite table
```sql
CREATE TABLE IF NOT EXISTS release_notes_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_path TEXT NOT NULL,
  from_label TEXT NOT NULL,
  to_label TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL   -- unix seconds
)
```
plus an index on `(repo_path, created_at)`.

Commands (camelCase on the wire):
- `add_release_note(repo_path, from_label, to_label, text) -> ReleaseNoteEntry`
  - If the newest entry for the repo has identical `from_label`, `to_label` and
    `text`, only its `created_at` is refreshed and it is returned (no duplicate).
  - Otherwise inserts, then deletes the oldest entries beyond 50 for that repo.
  - Empty or whitespace-only `text` is rejected (`AppError::Operation`).
- `list_release_notes(repo_path) -> Vec<ReleaseNoteEntry>`, newest first.
- `delete_release_note(id)`.

`ReleaseNoteEntry { id, fromLabel, toLabel, text, createdAt }`.

Frontend:
- `releaseNotesHistoryStore`: `byRepo[path]`, `load(path)`, `add(...)`, `remove(...)`.
- Saving happens when the user presses Copy or Cmd+Enter in the dialog, after a
  successful copy, with the text exactly as copied. Save failures are silent to
  the copy flow (a toast "Couldn't save to history" only).
- Dialog footer gets a **History** button, shown for the active repo. It opens a
  list in the dialog body, newest first, each row "Oct 8 · after <from> → <to>".
  Clicking a row shows that text read-only in the text area with a banner
  "Saved copy from <date> · Back to live", and the footer shows Copy and Delete
  for it. The From/To/Swap/toggles are disabled while viewing a saved copy.
  Copy on a saved copy copies it as before and does not add a new entry.
  Delete removes it and returns to the list. An empty list shows "Nothing saved
  yet. Copied notes appear here."
- Escape: closes history view first (back to live), then the dialog.

## Error handling

- Pattern with no matching reachable tag: toast, no dialog.
- Backend/DB errors: error toast; the release-notes dialog and copy keep working.
- History list load failure: inline "Couldn't load history" inside the list.

## Testing

Rust: pattern matching (glob, empty = all), reachable vs unreachable tag,
annotated vs lightweight date, tie-break, detached HEAD, no match, unborn HEAD;
history add/list/delete, de-dup refresh, cap of 50 per repo (other repos
unaffected), empty text rejected; settings column migration on an existing DB.

Vitest: settings form field; button and palette call the flow and show the right
toasts; history store; dialog saves on Copy and Cmd+Enter (not on saved-copy
Copy), list/view/back/delete/empty states, controls disabled while viewing.

## Open questions

None.
