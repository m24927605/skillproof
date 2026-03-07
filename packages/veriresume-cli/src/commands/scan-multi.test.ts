import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { discoverLocalRepos } from "./scan-multi.ts";

const execFileAsync = promisify(execFile);

describe("scan-multi", () => {
  describe("discoverLocalRepos", () => {
    it("finds git repos in parent directory and ignores non-repos", async () => {
      const parentDir = path.join(os.tmpdir(), `veriresume-test-${Date.now()}`);
      await mkdir(parentDir, { recursive: true });
      await mkdir(path.join(parentDir, "repo-a", ".git"), { recursive: true });
      const repoB = path.join(parentDir, "repo-b");
      await mkdir(repoB, { recursive: true });
      await execFileAsync("git", ["init"], { cwd: repoB });
      await mkdir(path.join(parentDir, "not-a-repo"), { recursive: true });
      await writeFile(path.join(parentDir, "file.txt"), "hello");

      try {
        const repos = await discoverLocalRepos(parentDir);
        const names = repos.map((r) => r.name).sort();
        assert.equal(repos.length, 2);
        assert.deepEqual(names, ["repo-a", "repo-b"]);
      } finally {
        await rm(parentDir, { recursive: true, force: true });
      }
    });

    it("returns empty for directory with no git repos", async () => {
      const parentDir = path.join(os.tmpdir(), `veriresume-empty-${Date.now()}`);
      await mkdir(parentDir, { recursive: true });
      await mkdir(path.join(parentDir, "just-a-dir"), { recursive: true });

      try {
        const repos = await discoverLocalRepos(parentDir);
        assert.equal(repos.length, 0);
      } finally {
        await rm(parentDir, { recursive: true, force: true });
      }
    });

    it("finds nested git repos recursively", async () => {
      const parentDir = path.join(os.tmpdir(), `veriresume-nested-${Date.now()}`);
      await mkdir(parentDir, { recursive: true });
      await mkdir(path.join(parentDir, "group", "repo-c", ".git"), { recursive: true });
      await mkdir(path.join(parentDir, "repo-d", ".git"), { recursive: true });

      try {
        const repos = await discoverLocalRepos(parentDir);
        const names = repos.map((r) => r.name).sort();
        assert.equal(repos.length, 2);
        assert.ok(names.includes("repo-c"), "should find nested repo");
        assert.ok(names.includes("repo-d"), "should find top-level repo");
      } finally {
        await rm(parentDir, { recursive: true, force: true });
      }
    });
  });
});
