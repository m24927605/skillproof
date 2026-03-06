import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCommitEvidence,
  createDependencyEvidence,
  createConfigEvidence,
  createPREvidence,
} from "./evidence.ts";

describe("evidence", () => {
  describe("createCommitEvidence", () => {
    it("creates evidence with correct id format", () => {
      const ev = createCommitEvidence({
        hash: "abc1234",
        author: "John",
        email: "john@ex.com",
        date: "2025-01-15T10:00:00Z",
        message: "feat: add login",
      });
      assert.equal(ev.id, "EV-COMMIT-abc1234");
      assert.equal(ev.type, "commit");
      assert.equal(ev.timestamp, "2025-01-15T10:00:00Z");
      assert.equal(ev.source, "abc1234");
      assert.ok(ev.hash.length === 64);
    });
  });

  describe("createDependencyEvidence", () => {
    it("creates evidence for a dependency", () => {
      const ev = createDependencyEvidence("redis", "package.json");
      assert.equal(ev.id, "EV-DEP-redis");
      assert.equal(ev.type, "dependency");
      assert.equal(ev.source, "package.json");
      assert.equal(ev.ownership, 1.0);
    });
  });

  describe("createConfigEvidence", () => {
    it("creates evidence for a config file", () => {
      const ev = createConfigEvidence("Dockerfile", "FROM node:20\nRUN npm install");
      assert.equal(ev.type, "config");
      assert.ok(ev.id.startsWith("EV-CONFIG-"));
      assert.equal(ev.source, "Dockerfile");
    });
  });

  describe("createPREvidence", () => {
    it("creates evidence for a merged PR", () => {
      const ev = createPREvidence({
        number: 42,
        title: "feat: add auth",
        mergedAt: "2025-06-15T10:00:00Z",
        url: "https://github.com/owner/repo/pull/42",
        additions: 150,
        deletions: 20,
      });
      assert.equal(ev.id, "EV-PR-42");
      assert.equal(ev.type, "pull_request");
      assert.equal(ev.source, "https://github.com/owner/repo/pull/42");
      assert.equal(ev.ownership, 1.0);
      assert.ok(ev.hash.length === 64);
      assert.deepEqual(ev.metadata, {
        title: "feat: add auth",
        additions: 150,
        deletions: 20,
      });
    });
  });
});
