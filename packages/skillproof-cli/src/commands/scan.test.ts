import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEvidence, parseCargoDeps } from "./scan.ts";

describe("scan", () => {
  describe("buildEvidence", () => {
    it("creates commit evidence from git commits", () => {
      const result = buildEvidence({
        commits: [
          { hash: "abc1234", author: "John", email: "j@ex.com", date: "2025-01-01T00:00:00Z", message: "feat: init" },
        ],
        files: [{ path: "src/index.ts", content: "const x = 1;", ownership: 0.75 }],
        dependencies: [{ name: "express", source: "package.json" }],
        configFiles: [],
        pullRequests: [],
      });

      const commitEv = result.find((e) => e.type === "commit");
      assert.ok(commitEv);
      assert.equal(commitEv.id, "EV-COMMIT-abc1234");
    });

    it("hashes actual file content, not file path", () => {
      const result = buildEvidence({
        commits: [],
        files: [{ path: "src/index.ts", content: "const hello = 'world';", ownership: 0.8 }],
        dependencies: [],
        configFiles: [],
        pullRequests: [],
      });

      const fileEv = result.find((e) => e.type === "file");
      assert.ok(fileEv);
      assert.equal(fileEv.source, "src/index.ts");
      assert.equal(fileEv.ownership, 0.8);
      assert.notEqual(fileEv.hash, fileEv.source);
      assert.equal(fileEv.hash.length, 64);
    });

    it("creates dependency evidence", () => {
      const result = buildEvidence({
        commits: [],
        files: [],
        dependencies: [{ name: "redis", source: "package.json" }],
        configFiles: [],
        pullRequests: [],
      });

      const depEv = result.find((e) => e.id === "EV-DEP-redis");
      assert.ok(depEv);
    });

    it("creates PR evidence", () => {
      const result = buildEvidence({
        commits: [],
        files: [],
        dependencies: [],
        configFiles: [],
        pullRequests: [{
          number: 42,
          title: "feat: auth",
          mergedAt: "2025-06-15T10:00:00Z",
          url: "https://github.com/o/r/pull/42",
          additions: 100,
          deletions: 10,
        }],
      });

      const prEv = result.find((e) => e.id === "EV-PR-42");
      assert.ok(prEv);
      assert.equal(prEv.type, "pull_request");
    });

    it("does not include sensitive files", () => {
      const result = buildEvidence({
        commits: [],
        files: [
          { path: "src/index.ts", content: "code", ownership: 1.0 },
        ],
        dependencies: [],
        configFiles: [],
        pullRequests: [],
      });

      const fileEvidence = result.filter((e) => e.type === "file");
      assert.equal(fileEvidence.length, 1);
    });

    it("excludes files containing secrets from evidence", () => {
      const result = buildEvidence({
        commits: [],
        files: [
          { path: "src/index.ts", content: "const x = 1;", ownership: 0.8 },
          { path: "src/config.ts", content: "const key = 'AKIAIOSFODNN7EXAMPLE';", ownership: 0.9 },
        ],
        dependencies: [],
        configFiles: [],
        pullRequests: [],
      });

      const fileEvidence = result.filter((e) => e.type === "file");
      assert.equal(fileEvidence.length, 1);
      assert.equal(fileEvidence[0].source, "src/index.ts");
    });
  });

  describe("parseCargoDeps", () => {
    it("only parses keys under dependency sections", () => {
      const content = [
        "[package]",
        'name = "my-app"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'serde = "1.0"',
        'tokio = { version = "1", features = ["full"] }',
        "",
        "[dev-dependencies]",
        'criterion = "0.5"',
        "",
        "[profile.release]",
        "opt-level = 3",
      ].join("\n");

      const deps = parseCargoDeps(content);
      const names = deps.map((d) => d.name);
      assert.ok(names.includes("serde"));
      assert.ok(names.includes("tokio"));
      assert.ok(names.includes("criterion"));
      assert.ok(!names.includes("name"));
      assert.ok(!names.includes("version"));
      assert.ok(!names.includes("edition"));
      assert.ok(!names.includes("opt-level"));
    });
  });
});
