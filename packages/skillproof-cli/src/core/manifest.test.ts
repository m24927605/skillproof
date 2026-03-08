import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createEmptyManifest,
  writeManifest,
  readManifest,
} from "./manifest.ts";

describe("manifest", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("createEmptyManifest", () => {
    it("creates a valid empty manifest", () => {
      const m = createEmptyManifest({
        repoUrl: "https://github.com/test/repo",
        headCommit: "abc123",
        authorName: "John",
        authorEmail: "john@example.com",
      });
      assert.equal(m.schema_version, "1.0");
      assert.equal(m.repo.url, "https://github.com/test/repo");
      assert.equal(m.repo.head_commit, "abc123");
      assert.equal(m.author.name, "John");
      assert.deepEqual(m.evidence, []);
      assert.deepEqual(m.skills, []);
      assert.deepEqual(m.claims, []);
      assert.deepEqual(m.signatures, []);
    });
  });

  describe("writeManifest / readManifest", () => {
    it("round-trips a manifest through the filesystem", async () => {
      const m = createEmptyManifest({
        repoUrl: null,
        headCommit: "def456",
        authorName: "Jane",
        authorEmail: "jane@example.com",
      });
      const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
      await writeManifest(manifestPath, m);

      const loaded = await readManifest(manifestPath);
      assert.deepEqual(loaded.repo.head_commit, "def456");
      assert.deepEqual(loaded.author.name, "Jane");
    });
  });
});
