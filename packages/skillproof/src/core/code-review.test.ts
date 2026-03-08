import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReviewPrompt, parseReviewResponse, parseGroupedReviewResponse, buildDigestReviewPrompt, buildGroupedDigestReviewPrompt } from "./code-review.ts";
import type { EvidenceDigest } from "./evidence-digest.ts";

describe("code-review", () => {
  describe("buildReviewPrompt", () => {
    it("builds system and user messages for code review", () => {
      const files = [
        { path: "src/index.ts", content: "const x = 1;", ownership: 0.8, skill: "TypeScript" },
        { path: "src/utils.ts", content: "export function add(a: number, b: number) { return a + b; }", ownership: 0.9, skill: "TypeScript" },
      ];
      const { systemMessage, userMessage } = buildReviewPrompt("TypeScript", files);
      assert.ok(systemMessage.includes("senior code reviewer"));
      assert.ok(userMessage.includes("TypeScript"));
      assert.ok(userMessage.includes("src/index.ts"));
      assert.ok(userMessage.includes("src/utils.ts"));
      assert.ok(userMessage.includes("const x = 1;"));
    });
  });

  describe("parseReviewResponse", () => {
    it("parses valid JSON response", () => {
      const json = JSON.stringify({
        skill: "TypeScript",
        quality_score: 0.85,
        reasoning: "Good code",
        strengths: ["type safety"],
      });
      const result = parseReviewResponse(json);
      assert.equal(result.quality_score, 0.85);
      assert.equal(result.reasoning, "Good code");
      assert.deepEqual(result.strengths, ["type safety"]);
    });

    it("extracts JSON from markdown code block", () => {
      const response = "Here is my review:\n```json\n{\"skill\":\"Go\",\"quality_score\":0.7,\"reasoning\":\"OK\",\"strengths\":[]}\n```";
      const result = parseReviewResponse(response);
      assert.equal(result.quality_score, 0.7);
    });

    it("clamps quality_score to 0-1 range", () => {
      const json = JSON.stringify({
        skill: "Python",
        quality_score: 1.5,
        reasoning: "Great",
        strengths: [],
      });
      const result = parseReviewResponse(json);
      assert.equal(result.quality_score, 1.0);
    });

    it("throws on invalid response", () => {
      assert.throws(() => parseReviewResponse("not json at all"), /Failed to parse/);
    });
  });

  describe("parseGroupedReviewResponse", () => {
    it("parses multi-skill JSON response", () => {
      const json = JSON.stringify({
        reviews: [
          { skill: "TypeScript", quality_score: 0.85, reasoning: "Good types", strengths: ["type safety"] },
          { skill: "React", quality_score: 0.7, reasoning: "OK components", strengths: ["hooks"] },
        ],
      });
      const results = parseGroupedReviewResponse(json);
      assert.equal(results.length, 2);
      assert.equal(results[0].skill, "TypeScript");
      assert.equal(results[0].quality_score, 0.85);
      assert.equal(results[1].skill, "React");
      assert.equal(results[1].quality_score, 0.7);
    });

    it("extracts from markdown code block", () => {
      const response = "```json\n" + JSON.stringify({
        reviews: [{ skill: "Go", quality_score: 0.6, reasoning: "OK", strengths: [] }],
      }) + "\n```";
      const results = parseGroupedReviewResponse(response);
      assert.equal(results.length, 1);
      assert.equal(results[0].skill, "Go");
    });

    it("clamps scores to 0-1 range", () => {
      const json = JSON.stringify({
        reviews: [{ skill: "Python", quality_score: 1.5, reasoning: "Great", strengths: [] }],
      });
      const results = parseGroupedReviewResponse(json);
      assert.equal(results[0].quality_score, 1.0);
    });

    it("throws on missing reviews array", () => {
      assert.throws(() => parseGroupedReviewResponse('{"skill":"Go"}'), /Failed to parse grouped/);
    });

    it("throws on invalid JSON", () => {
      assert.throws(() => parseGroupedReviewResponse("not json"), /Failed to parse grouped/);
    });
  });

  describe("buildDigestReviewPrompt", () => {
    it("includes digest summary lines in prompt", () => {
      const digest: EvidenceDigest = {
        summaryLines: ["Owned 4 TypeScript files", "Has tests covering API handlers"],
        snippetBlocks: [
          { path: "src/api.ts", note: "ownership: 95%", content: "export function handleRequest() {}" },
        ],
      };
      const { systemMessage, userMessage } = buildDigestReviewPrompt("TypeScript", digest);
      assert.ok(userMessage.includes("Owned 4 TypeScript files"));
      assert.ok(userMessage.includes("Has tests covering API handlers"));
      assert.ok(systemMessage.includes("Score only from supplied evidence"));
    });

    it("includes compact snippets, not full file sections", () => {
      const digest: EvidenceDigest = {
        summaryLines: ["2 file(s)"],
        snippetBlocks: [
          { path: "src/handler.ts", note: "ownership: 90%", content: "const x = 1;" },
        ],
      };
      const { userMessage } = buildDigestReviewPrompt("TypeScript", digest);
      assert.ok(userMessage.includes("src/handler.ts"));
      assert.ok(userMessage.includes("const x = 1;"));
      // Should be marked as snippet, not full file
      assert.ok(userMessage.includes("snippet") || userMessage.includes("Snippet"));
    });

    it("parser remains unchanged", () => {
      const json = JSON.stringify({
        skill: "TypeScript",
        quality_score: 0.8,
        reasoning: "Good",
        strengths: ["types"],
      });
      const result = parseReviewResponse(json);
      assert.equal(result.quality_score, 0.8);
    });
  });

  describe("buildGroupedDigestReviewPrompt", () => {
    it("includes per-skill digest sections", () => {
      const skillDigests = new Map<string, EvidenceDigest>([
        ["TypeScript", {
          summaryLines: ["Owned 4 TypeScript files"],
          snippetBlocks: [{ path: "src/app.ts", note: "ownership: 95%", content: "const x = 1;" }],
        }],
        ["React", {
          summaryLines: ["3 React components"],
          snippetBlocks: [{ path: "src/App.tsx", note: "ownership: 90%", content: "<App />" }],
        }],
      ]);
      const { systemMessage, userMessage } = buildGroupedDigestReviewPrompt(
        ["TypeScript", "React"], skillDigests
      );
      assert.ok(userMessage.includes("TypeScript"));
      assert.ok(userMessage.includes("React"));
      assert.ok(userMessage.includes("Owned 4 TypeScript files"));
      assert.ok(userMessage.includes("3 React components"));
      assert.ok(systemMessage.includes("Score each skill solely from that skill's own evidence section"));
    });

    it("shared context is non-scoring orientation", () => {
      const skillDigests = new Map<string, EvidenceDigest>([
        ["Go", {
          summaryLines: ["2 Go files"],
          snippetBlocks: [],
        }],
      ]);
      const { systemMessage } = buildGroupedDigestReviewPrompt(["Go"], skillDigests);
      assert.ok(systemMessage.includes("non-scoring") || systemMessage.includes("orientation only"));
    });
  });
});
