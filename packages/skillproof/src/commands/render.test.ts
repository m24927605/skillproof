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

  it("uses displayName and contactEmail when provided", () => {
    const manifest: Manifest = {
      schema_version: "1.0",
      generated_at: "2025-01-01T00:00:00Z",
      repo: { url: null, head_commit: "abc" },
      author: { name: "git-name", email: "git@example.com" },
      evidence: [],
      skills: [],
      claims: [],
      signatures: [],
    };
    const md = renderResume(manifest, { displayName: "My Name", contactEmail: "me@resume.com" });
    assert.ok(md.includes("# My Name"));
    assert.ok(md.includes("me@resume.com"));
    assert.ok(!md.includes("git-name"));
  });

  it("displays strengths when available", () => {
    const manifest: Manifest = {
      schema_version: "1.0",
      generated_at: "2025-01-01T00:00:00Z",
      repo: { url: null, head_commit: "abc" },
      author: { name: "Jane", email: "jane@ex.com" },
      evidence: [],
      skills: [
        {
          name: "TypeScript",
          confidence: 0.85,
          evidence_ids: [],
          inferred_by: "llm",
          strengths: ["Strong type definitions", "Good error handling"],
          reasoning: "Solid TypeScript usage",
        },
      ],
      claims: [],
      signatures: [],
    };
    const md = renderResume(manifest);
    assert.ok(md.includes("Strong type definitions"));
    assert.ok(md.includes("Good error handling"));
  });

  it("does not display reasoning in resume body", () => {
    const manifest: Manifest = {
      schema_version: "1.0",
      generated_at: "2025-01-01T00:00:00Z",
      repo: { url: null, head_commit: "abc" },
      author: { name: "Jane", email: "jane@ex.com" },
      evidence: [],
      skills: [
        {
          name: "TypeScript",
          confidence: 0.85,
          evidence_ids: [],
          inferred_by: "llm",
          strengths: [],
          reasoning: "Internal reasoning note",
        },
      ],
      claims: [],
      signatures: [],
    };
    const md = renderResume(manifest);
    assert.ok(!md.includes("Internal reasoning note"));
  });

  it("renders static-only skill conservatively", () => {
    const manifest: Manifest = {
      schema_version: "1.0",
      generated_at: "2025-01-01T00:00:00Z",
      repo: { url: null, head_commit: "abc" },
      author: { name: "Jane", email: "jane@ex.com" },
      evidence: [],
      skills: [
        {
          name: "Redis",
          confidence: 0.4,
          evidence_ids: ["EV-1"],
          inferred_by: "static",
          static_confidence: 0.4,
          review_decision: "static-only",
        },
      ],
      claims: [],
      signatures: [],
    };
    const md = renderResume(manifest);
    assert.ok(md.includes("static-only") || md.includes("Static"), "should indicate static scoring");
    assert.ok(!md.includes("Strengths"), "static-only should not show strengths section");
  });

  it("renders llm-reviewed skill with strengths", () => {
    const manifest: Manifest = {
      schema_version: "1.0",
      generated_at: "2025-01-01T00:00:00Z",
      repo: { url: null, head_commit: "abc" },
      author: { name: "Jane", email: "jane@ex.com" },
      evidence: [],
      skills: [
        {
          name: "TypeScript",
          confidence: 0.72,
          evidence_ids: ["EV-1"],
          inferred_by: "llm",
          static_confidence: 0.5,
          llm_confidence: 0.85,
          review_decision: "llm-reviewed",
          strengths: ["Strong types", "Good patterns"],
          reasoning: "Solid usage",
        },
      ],
      claims: [],
      signatures: [],
    };
    const md = renderResume(manifest);
    assert.ok(md.includes("Strong types"));
    assert.ok(md.includes("Good patterns"));
    assert.ok(md.includes("reviewed") || md.includes("Reviewed"), "should indicate LLM reviewed");
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
