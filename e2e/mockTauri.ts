import { Page } from "@playwright/test";

export async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    const repos: any[] = [];
    let nextId = 1;

    const branchesByPath: Record<string, any[]> = {
      "/fake/repo-a": [
        { name: "main", isRemote: false, isHead: true, targetOid: "c2" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "c2" },
      ],
    };
    const tagsByPath: Record<string, any[]> = { "/fake/repo-a": [] };
    const commitsByPath: Record<string, any[]> = {
      "/fake/repo-a": [
        {
          oid: "c2",
          summary: "second commit",
          author: "Test User",
          timestamp: 200,
          lane: 0,
          edges: [{ parentOid: "c1", parentLane: 0 }],
          activeLanes: [true],
        },
        {
          oid: "c1",
          summary: "first commit",
          author: "Test User",
          timestamp: 100,
          lane: 0,
          edges: [],
          activeLanes: [false],
        },
      ],
    };
    const searchFixture = [
      { oid: "c1", summary: "first commit", author: "Test User", timestamp: 100, snippet: "...one..." },
      { oid: "c2", summary: "second commit", author: "Test User", timestamp: 200, snippet: "...two..." },
    ];
    const statusFixture = [{ path: "new.txt", state: "Untracked" }];
    const commitDiffFixture = {
      oid: "c2",
      author: "Test User",
      email: "test@example.com",
      timestamp: 200,
      message: "second commit",
      files: [
        {
          path: "a.txt",
          status: "modified",
          patch: "-one\n+two\n",
          oldContent: "one",
          newContent: "two",
          insertions: 1,
          deletions: 1,
        },
      ],
    };

    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        switch (cmd) {
          case "plugin:dialog|open":
            return "/fake/repo-a";
          case "list_repos":
            return [...repos];
          case "add_repo": {
            const name = args.path.split("/").pop();
            const entry = { id: nextId++, path: args.path, name, pinned: false };
            repos.push(entry);
            return entry;
          }
          case "get_branches":
            return branchesByPath[args.repoPath] ?? [];
          case "get_tags":
            return tagsByPath[args.repoPath] ?? [];
          case "get_commit_graph":
            return commitsByPath[args.repoPath] ?? [];
          case "ensure_search_index":
            return null;
          case "search_commits":
            return searchFixture.filter((hit) => {
              const q = args.query as string;
              if (q && !(hit.summary.includes(q) || hit.snippet.includes(q))) return false;
              const a = args.author as string | undefined;
              if (a && !hit.author.toLowerCase().includes(a.toLowerCase())) return false;
              return true;
            });
          case "get_status":
            return statusFixture;
          case "stage_file":
          case "unstage_file":
            return null;
          case "commit_changes":
            return "newcommitoid";
          case "get_commit_diff":
            return commitDiffFixture;
          default:
            throw new Error(`unmocked Tauri command: ${cmd}`);
        }
      },
    };
  });
}
