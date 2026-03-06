import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, estimateCost, buildEstimateDisplay } from "./token-estimate.ts";

describe("token-estimate", () => {
  describe("estimateTokens", () => {
    it("estimates tokens from character count", () => {
      const text = "a".repeat(400);
      assert.equal(estimateTokens(text), 100);
    });

    it("returns 0 for empty string", () => {
      assert.equal(estimateTokens(""), 0);
    });
  });

  describe("estimateCost", () => {
    it("calculates cost from input and output tokens", () => {
      const cost = estimateCost(100000, 5000);
      // Input: 100K * $3/1M = $0.30, Output: 5K * $15/1M = $0.075
      assert.ok(cost > 0.37 && cost < 0.38);
    });

    it("returns 0 for zero tokens", () => {
      assert.equal(estimateCost(0, 0), 0);
    });
  });

  describe("buildEstimateDisplay", () => {
    it("builds display string with both options", () => {
      const display = buildEstimateDisplay({
        eligibleFiles: 87,
        skillCount: 12,
        fullInputTokens: 120000,
        fullOutputTokens: 5000,
        sampledInputTokens: 30000,
        sampledOutputTokens: 2000,
        sampledFilesPerSkill: 3,
      });
      assert.ok(display.includes("87"));
      assert.ok(display.includes("12"));
      assert.ok(display.includes("[A]"));
      assert.ok(display.includes("[B]"));
      assert.ok(display.includes("Full"));
      assert.ok(display.includes("Sampled"));
    });
  });
});
