import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferStaticSkills } from "./skills.ts";
import type { Evidence } from "../types/manifest.ts";

describe("skills", () => {
  describe("inferStaticSkills", () => {
    it("infers Docker from Dockerfile evidence", () => {
      const evidence: Evidence[] = [
        {
          id: "EV-CONFIG-abc",
          type: "config",
          hash: "abc",
          timestamp: "2025-01-01T00:00:00Z",
          ownership: 1.0,
          source: "Dockerfile",
        },
      ];
      const skills = inferStaticSkills(evidence);
      const docker = skills.find((s) => s.name === "Docker");
      assert.ok(docker);
      assert.equal(docker.inferred_by, "static");
      assert.ok(docker.evidence_ids.includes("EV-CONFIG-abc"));
    });

    it("infers Redis from dependency evidence", () => {
      const evidence: Evidence[] = [
        {
          id: "EV-DEP-redis",
          type: "dependency",
          hash: "def",
          timestamp: "2025-01-01T00:00:00Z",
          ownership: 1.0,
          source: "package.json",
        },
      ];
      const skills = inferStaticSkills(evidence);
      const redis = skills.find((s) => s.name === "Redis");
      assert.ok(redis);
    });

    it("infers TypeScript from .ts file evidence", () => {
      const evidence: Evidence[] = [
        {
          id: "EV-FILE-xyz",
          type: "file",
          hash: "xyz",
          timestamp: "2025-01-01T00:00:00Z",
          ownership: 0.8,
          source: "src/index.ts",
        },
      ];
      const skills = inferStaticSkills(evidence);
      const ts = skills.find((s) => s.name === "TypeScript");
      assert.ok(ts);
    });

    it("infers Code Review from PR evidence", () => {
      const evidence: Evidence[] = [
        {
          id: "EV-PR-42",
          type: "pull_request",
          hash: "abc",
          timestamp: "2025-06-15T10:00:00Z",
          ownership: 1.0,
          source: "https://github.com/o/r/pull/42",
          metadata: { title: "feat: auth", additions: 100, deletions: 10 },
        },
        {
          id: "EV-PR-43",
          type: "pull_request",
          hash: "def",
          timestamp: "2025-06-16T10:00:00Z",
          ownership: 1.0,
          source: "https://github.com/o/r/pull/43",
          metadata: { title: "fix: bug", additions: 20, deletions: 5 },
        },
      ];
      const skills = inferStaticSkills(evidence);
      const codeReview = skills.find((s) => s.name === "Code Review");
      assert.ok(codeReview);
      assert.equal(codeReview.evidence_ids.length, 2);
    });

    it("returns empty for no matching signals", () => {
      const evidence: Evidence[] = [
        {
          id: "EV-FILE-abc",
          type: "file",
          hash: "abc",
          timestamp: "2025-01-01T00:00:00Z",
          ownership: 1.0,
          source: "README.md",
        },
      ];
      const skills = inferStaticSkills(evidence);
      assert.equal(skills.length, 0);
    });
  });
});
