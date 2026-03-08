import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, estimateCost, buildEstimateDisplay, buildCostPreviewDisplay } from "./token-estimate.ts";

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

  describe("buildCostPreviewDisplay", () => {
    it("shows basic cost estimate", () => {
      const preview = {
        totalGroups: 3,
        cachedGroups: 0,
        totalInputTokens: 100000,
        actualInputTokens: 100000,
        totalOutputTokens: 600,
        actualOutputTokens: 600,
        totalCost: 0.309,
        actualCost: 0.309,
      };
      const display = buildCostPreviewDisplay(preview);
      assert.ok(display.includes("Review groups: 3"));
      assert.ok(display.includes("~100K"));
      assert.ok(display.includes("$0.31"));
      assert.ok(!display.includes("Cache hits"));
    });

    it("shows cache savings when cache hits exist", () => {
      const preview = {
        totalGroups: 5,
        cachedGroups: 3,
        totalInputTokens: 150000,
        actualInputTokens: 60000,
        totalOutputTokens: 1000,
        actualOutputTokens: 400,
        totalCost: 0.465,
        actualCost: 0.186,
      };
      const display = buildCostPreviewDisplay(preview);
      assert.ok(display.includes("Cache hits: 3/5"));
      assert.ok(display.includes("Actual reviews needed: 2"));
      assert.ok(display.includes("$0.19"));
    });
  });
});
