import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPromptMessages } from "./llm.ts";
import type { Manifest } from "../types/manifest.ts";

const manifest: Manifest = {
  schema_version: "1.0",
  generated_at: "2026-01-01T00:00:00Z",
  repo: { url: "https://github.com/test/repo", head_commit: "abc1234" },
  author: { name: "Alice", email: "alice@test.com" },
  evidence: [
    { id: "EV-1", type: "commit", hash: "a", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "abc" },
    { id: "EV-2", type: "file", hash: "b", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "f.ts" },
  ],
  skills: [
    { name: "TypeScript", confidence: 1, evidence_ids: ["EV-2"], inferred_by: "static" },
    { name: "Node.js", confidence: 0.8, evidence_ids: ["EV-1"], inferred_by: "llm" },
  ],
  claims: [],
  signatures: [],
};

describe("llm", () => {
  describe("buildPromptMessages", () => {
    it("includes author info in user message", () => {
      const { userMessage } = buildPromptMessages(manifest, "zh-TW", null);
      assert.ok(userMessage.includes("Alice"));
      assert.ok(userMessage.includes("alice@test.com"));
    });

    it("includes skills sorted by confidence", () => {
      const { userMessage } = buildPromptMessages(manifest, "zh-TW", null);
      const tsIdx = userMessage.indexOf("TypeScript");
      const nodeIdx = userMessage.indexOf("Node.js");
      assert.ok(tsIdx < nodeIdx, "TypeScript (1.0) should come before Node.js (0.8)");
    });

    it("includes evidence stats", () => {
      const { userMessage } = buildPromptMessages(manifest, "en-US", null);
      assert.ok(userMessage.includes("2")); // total evidence
      assert.ok(userMessage.includes("1")); // commits
    });

    it("includes locale in system message", () => {
      const { systemMessage } = buildPromptMessages(manifest, "ja", null);
      assert.ok(systemMessage.includes("ja"));
    });

    it("includes personal info when provided", () => {
      const { userMessage } = buildPromptMessages(manifest, "zh-TW", "5 years backend experience");
      assert.ok(userMessage.includes("5 years backend experience"));
    });

    it("indicates no personal info when null", () => {
      const { userMessage } = buildPromptMessages(manifest, "zh-TW", null);
      assert.ok(userMessage.includes("None"));
    });

    it("includes strengths and reasoning in user message when available", () => {
      const manifestWithReview: Manifest = {
        ...manifest,
        skills: [
          {
            name: "TypeScript",
            confidence: 0.85,
            evidence_ids: ["EV-2"],
            inferred_by: "llm",
            strengths: ["Strong type definitions", "Good error handling"],
            reasoning: "Demonstrates solid TypeScript proficiency with strict typing",
          },
        ],
      };
      const { userMessage } = buildPromptMessages(manifestWithReview, "en-US", null);
      assert.ok(userMessage.includes("Strong type definitions"));
      assert.ok(userMessage.includes("Good error handling"));
      assert.ok(userMessage.includes("Demonstrates solid TypeScript proficiency"));
    });

    it("includes strengths but not reasoning in user message", () => {
      const manifestWithReview: Manifest = {
        ...manifest,
        skills: [
          {
            name: "TypeScript",
            confidence: 0.85,
            evidence_ids: ["EV-2"],
            inferred_by: "llm",
            strengths: ["Good code"],
            reasoning: "Internal note",
          },
        ],
      };
      const { userMessage } = buildPromptMessages(manifestWithReview, "en-US", null);
      assert.ok(userMessage.includes("Good code"));
    });

    it("uses displayName and contactEmail when provided", () => {
      const { userMessage } = buildPromptMessages(manifest, "en-US", null, {
        displayName: "Bob Smith",
        contactEmail: "bob@resume.com",
      });
      assert.ok(userMessage.includes("Bob Smith"));
      assert.ok(userMessage.includes("bob@resume.com"));
      assert.ok(!userMessage.includes("Alice |"));
    });
  });
});
