import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReviewPrompt, parseReviewResponse, buildGroupedReviewPrompt, parseGroupedReviewResponse } from "./code-review.ts";

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

  describe("buildGroupedReviewPrompt", () => {
    it("includes all skill names and file contents", () => {
      const files = [
        { path: "src/app.tsx", content: "export default App;", ownership: 0.9, skill: "React" },
        { path: "src/index.ts", content: "const x = 1;", ownership: 0.8, skill: "TypeScript" },
      ];
      const { systemMessage, userMessage } = buildGroupedReviewPrompt(["TypeScript", "React"], files);
      assert.ok(systemMessage.includes("EACH"));
      assert.ok(systemMessage.includes("TypeScript, React"));
      assert.ok(userMessage.includes("TypeScript, React"));
      assert.ok(userMessage.includes("src/app.tsx"));
      assert.ok(userMessage.includes("src/index.ts"));
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
});
