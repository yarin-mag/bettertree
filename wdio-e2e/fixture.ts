import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

export function createFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bettertree-real-e2e-"));
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "one");
  execSync("git add a.txt", { cwd: dir });
  execSync('git commit -m "first commit"', { cwd: dir });
  return dir;
}

export function seedWorkspaceDb(repoPath: string, repoName: string) {
  const appDataDir = join(homedir(), "Library", "Application Support", "bettertree");
  mkdirSync(appDataDir, { recursive: true });
  const dbPath = join(appDataDir, "workspace.db");
  const sql = `
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0
    );
    DELETE FROM repos;
    INSERT INTO repos (path, name, pinned) VALUES ('${repoPath}', '${repoName}', 0);
  `;
  execSync(`sqlite3 "${dbPath}" "${sql.replace(/\n/g, " ")}"`);
}
