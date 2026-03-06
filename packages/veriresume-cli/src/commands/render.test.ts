import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderResume } from "./render.ts";
import type { Manifest } from "../types/manifest.ts";

describe("render", () => {
  it("generates markdown with skills sorted by confidence", () => {
    const manifest: Manifest = {
      schema_version: "1.0",
      generated_at: "2025-01-01T00:00:00Z",
      repo: { url: "https://github.com/test/repo", head_commit: "abc123" },
      author: { name: "John Doe", email: "john@example.com" },
      evidence: [
        { id: "EV-DEP-redis", type: "dependency", hash: "a", timestamp: "2025-01-01T00:00:00Z", ownership: 1.0, source: "package.json" },
        { id: "EV-COMMIT-abc", type: "commit", hash: "b", timestamp: "2025-01-01T00:00:00Z", ownership: 1.0, source: "abc" },
      ],
      skills: [
        { name: "Redis", confidence: 0.82, evidence_ids: ["EV-DEP-redis"], inferred_by: "static" },
        { name: "TypeScript", confidence: 0.90, evidence_ids: ["EV-COMMIT-abc"], inferred_by: "static" },
      ],
      claims: [],
      signatures: [],
    };

    const md = renderResume(manifest);
    assert.ok(md.includes("John Doe"));
    assert.ok(md.includes("Redis"));
    assert.ok(md.includes("TypeScript"));
    const tsIndex = md.indexOf("TypeScript");
    const redisIndex = md.indexOf("Redis");
    assert.ok(tsIndex < redisIndex, "Skills should be sorted by confidence desc");
  });

  it("includes evidence count summary", () => {
    const manifest: Manifest = {
      schema_version: "1.0",
      generated_at: "2025-01-01T00:00:00Z",
      repo: { url: null, head_commit: "abc" },
      author: { name: "Jane", email: "jane@ex.com" },
      evidence: [],
      skills: [],
      claims: [],
      signatures: [],
    };
    const md = renderResume(manifest);
    assert.ok(md.includes("Jane"));
    assert.ok(md.includes("0"));
  });
});
