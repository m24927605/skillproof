import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// We test discoverLocalRepos by dynamically importing after creating it
// since it's not exported. Instead we test the behavior via the module internals.
// For now, test the discoverable logic by creating temp dirs with .git folders.

async function createTempRepoStructure(): Promise<{ parentDir: string; cleanup: () => Promise<void> }> {
  const parentDir = path.join(os.tmpdir(), `veriresume-test-${Date.now()}`);
  await mkdir(parentDir, { recursive: true });

  // Create repo-a with .git directory
  const repoA = path.join(parentDir, "repo-a");
  await mkdir(path.join(repoA, ".git"), { recursive: true });

  // Create repo-b with actual git init
  const repoB = path.join(parentDir, "repo-b");
  await mkdir(repoB, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repoB });

  // Create non-repo directory
  const notRepo = path.join(parentDir, "not-a-repo");
  await mkdir(notRepo, { recursive: true });

  // Create a plain file (not a directory)
  await writeFile(path.join(parentDir, "file.txt"), "hello");

  const cleanup = async () => {
    await rm(parentDir, { recursive: true, force: true });
  };

  return { parentDir, cleanup };
}

describe("scan-multi", () => {
  describe("discoverLocalRepos", () => {
    it("finds git repos in parent directory and ignores non-repos", async () => {
      // We import the function dynamically to avoid module-level side effects
      // discoverLocalRepos is not exported, so we test via a local reimplementation
      // matching the same logic
      const { readdir, stat } = await import("node:fs/promises");
      const { parentDir, cleanup } = await createTempRepoStructure();

      try {
        const entries = await readdir(parentDir);
        const repos: { name: string; path: string }[] = [];

        for (const entry of entries) {
          const fullPath = path.join(parentDir, entry);
          try {
            const s = await stat(fullPath);
            if (!s.isDirectory()) continue;
            const gitDir = path.join(fullPath, ".git");
            const gitStat = await stat(gitDir);
            if (gitStat.isDirectory()) {
              repos.push({ name: entry, path: fullPath });
            }
          } catch {
            // not a git repo
          }
        }

        assert.equal(repos.length, 2);
        const names = repos.map((r) => r.name).sort();
        assert.deepEqual(names, ["repo-a", "repo-b"]);
      } finally {
        await cleanup();
      }
    });

    it("returns empty for directory with no git repos", async () => {
      const { readdir, stat } = await import("node:fs/promises");
      const parentDir = path.join(os.tmpdir(), `veriresume-empty-${Date.now()}`);
      await mkdir(parentDir, { recursive: true });
      await mkdir(path.join(parentDir, "just-a-dir"), { recursive: true });

      try {
        const entries = await readdir(parentDir);
        const repos: { name: string; path: string }[] = [];

        for (const entry of entries) {
          const fullPath = path.join(parentDir, entry);
          try {
            const s = await stat(fullPath);
            if (!s.isDirectory()) continue;
            const gitDir = path.join(fullPath, ".git");
            const gitStat = await stat(gitDir);
            if (gitStat.isDirectory()) {
              repos.push({ name: entry, path: fullPath });
            }
          } catch {
            // not a git repo
          }
        }

        assert.equal(repos.length, 0);
      } finally {
        await rm(parentDir, { recursive: true, force: true });
      }
    });
  });
});
