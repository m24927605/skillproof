import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prefixEvidence, mergeSkills, mergeManifests } from "./merge.ts";
import type { Evidence, Skill, Manifest } from "../types/manifest.ts";

describe("merge", () => {
  describe("prefixEvidence", () => {
    it("adds repo prefix to evidence id and source", () => {
      const evidence: Evidence[] = [
        { id: "EV-COMMIT-abc", type: "commit", hash: "h1", timestamp: "t1", ownership: 1, source: "abc" },
        { id: "EV-FILE-xyz", type: "file", hash: "h2", timestamp: "t2", ownership: 0.8, source: "src/index.ts" },
      ];
      const result = prefixEvidence(evidence, "my-repo");
      assert.equal(result[0].id, "my-repo:EV-COMMIT-abc");
      assert.equal(result[0].source, "my-repo/abc");
      assert.equal(result[1].id, "my-repo:EV-FILE-xyz");
      assert.equal(result[1].source, "my-repo/src/index.ts");
    });
  });

  describe("mergeSkills", () => {
    it("merges same-name skills keeping highest confidence", () => {
      const skills: Skill[] = [
        { name: "TypeScript", confidence: 0.9, evidence_ids: ["a:EV-1"], inferred_by: "static" },
        { name: "TypeScript", confidence: 1.0, evidence_ids: ["b:EV-2"], inferred_by: "static" },
        { name: "Python", confidence: 0.7, evidence_ids: ["a:EV-3"], inferred_by: "static" },
      ];
      const result = mergeSkills(skills);
      assert.equal(result.length, 2);

      const ts = result.find((s) => s.name === "TypeScript");
      assert.ok(ts);
      assert.equal(ts.confidence, 1.0);
      assert.deepEqual(ts.evidence_ids, ["a:EV-1", "b:EV-2"]);

      const py = result.find((s) => s.name === "Python");
      assert.ok(py);
      assert.equal(py.confidence, 0.7);
    });

    it("adopts provenance metadata from higher-confidence skill", () => {
      const skills: Skill[] = [
        {
          name: "TypeScript",
          confidence: 0.4,
          evidence_ids: ["a:EV-1"],
          inferred_by: "static",
          static_confidence: 0.4,
          review_decision: "static-only",
        },
        {
          name: "TypeScript",
          confidence: 0.72,
          evidence_ids: ["b:EV-2"],
          inferred_by: "llm",
          static_confidence: 0.5,
          llm_confidence: 0.85,
          review_decision: "llm-reviewed",
          strengths: ["Strong types"],
          reasoning: "Solid usage",
        },
      ];
      const result = mergeSkills(skills);
      const ts = result.find((s) => s.name === "TypeScript")!;
      assert.equal(ts.confidence, 0.72);
      assert.equal(ts.inferred_by, "llm");
      assert.equal(ts.review_decision, "llm-reviewed");
      assert.equal(ts.llm_confidence, 0.85);
      assert.deepEqual(ts.strengths, ["Strong types"]);
      assert.equal(ts.reasoning, "Solid usage");
      // evidence_ids should be merged from both
      assert.deepEqual(ts.evidence_ids, ["a:EV-1", "b:EV-2"]);
    });

    it("keeps first skill metadata when it has higher confidence", () => {
      const skills: Skill[] = [
        {
          name: "React",
          confidence: 0.8,
          evidence_ids: ["a:EV-1"],
          inferred_by: "llm",
          strengths: ["Good hooks"],
          review_decision: "llm-reviewed",
        },
        {
          name: "React",
          confidence: 0.3,
          evidence_ids: ["b:EV-2"],
          inferred_by: "static",
          review_decision: "static-only",
        },
      ];
      const result = mergeSkills(skills);
      const react = result.find((s) => s.name === "React")!;
      assert.equal(react.confidence, 0.8);
      assert.equal(react.inferred_by, "llm");
      assert.deepEqual(react.strengths, ["Good hooks"]);
      assert.deepEqual(react.evidence_ids, ["a:EV-1", "b:EV-2"]);
    });
  });

  describe("mergeManifests", () => {
    it("merges multiple manifests into one", () => {
      const m1: Manifest = {
        schema_version: "1.0",
        generated_at: "2026-01-01T00:00:00Z",
        repo: { url: "https://github.com/u/a", head_commit: "aaa" },
        author: { name: "Alice", email: "alice@test.com" },
        evidence: [{ id: "EV-1", type: "commit", hash: "h", timestamp: "t", ownership: 1, source: "x" }],
        skills: [{ name: "TypeScript", confidence: 0.9, evidence_ids: ["EV-1"], inferred_by: "static" }],
        claims: [],
        signatures: [],
      };
      const m2: Manifest = {
        schema_version: "1.0",
        generated_at: "2026-01-01T00:00:00Z",
        repo: { url: "https://github.com/u/b", head_commit: "bbb" },
        author: { name: "Alice", email: "alice@test.com" },
        evidence: [{ id: "EV-1", type: "file", hash: "h2", timestamp: "t", ownership: 1, source: "y.ts" }],
        skills: [{ name: "TypeScript", confidence: 1.0, evidence_ids: ["EV-1"], inferred_by: "static" }],
        claims: [],
        signatures: [],
      };

      const result = mergeManifests([
        { manifest: m1, repoName: "repo-a" },
        { manifest: m2, repoName: "repo-b" },
      ]);

      assert.equal(result.evidence.length, 2);
      assert.ok(result.evidence[0].id.startsWith("repo-a:"));
      assert.ok(result.evidence[1].id.startsWith("repo-b:"));
      assert.equal(result.skills.length, 1);
      assert.equal(result.skills[0].confidence, 1.0);
      assert.equal(result.skills[0].evidence_ids.length, 2);
      assert.ok(result.repos);
      assert.equal(result.repos!.length, 2);
    });
  });
});
