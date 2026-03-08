import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, estimateCost, truncateFileContent, buildEstimateDisplay, buildCostPreviewDisplay } from "./token-estimate.ts";
import type { FileForReview } from "./token-estimate.ts";
import { groupSkillsByFileOverlap } from "./skill-grouping.ts";

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
      assert.ok(display.includes("$0.19"));
    });
  });

  describe("buildCostPreviewDisplay with gating", () => {
    it("shows review/skip split when gating info provided", () => {
      const preview = {
        totalGroups: 3,
        cachedGroups: 0,
        totalInputTokens: 80000,
        actualInputTokens: 80000,
        totalOutputTokens: 600,
        actualOutputTokens: 600,
        totalCost: 0.249,
        actualCost: 0.249,
        totalDetectedSkills: 12,
        selectedForReview: 4,
        staticOnlySkills: 8,
      };
      const display = buildCostPreviewDisplay(preview);
      assert.ok(display.includes("12"), "should include total detected");
      assert.ok(display.includes("4"), "should include selected for review");
      assert.ok(display.includes("8"), "should include static-only count");
      assert.ok(display.includes("static-only") || display.includes("Static-only"), "should mention static-only");
    });
  });

  describe("buildCostPreviewDisplay with per-skill cache", () => {
    it("partial-cache group shows lower actual cost than total", () => {
      const preview = {
        totalGroups: 2,
        cachedGroups: 0,
        totalInputTokens: 100000,
        actualInputTokens: 30000,
        totalOutputTokens: 600,
        actualOutputTokens: 200,
        totalCost: 0.309,
        actualCost: 0.093,
        totalReviewSkills: 3,
        cachedReviewSkills: 2,
      };
      const display = buildCostPreviewDisplay(preview);
      assert.ok(display.includes("Cached skills: 2/3"));
      assert.ok(display.includes("Skills needing review: 1"));
      assert.ok(display.includes("$0.09"));
    });

    it("full group hits and full misses remain stable", () => {
      // All cached
      const allCached = buildCostPreviewDisplay({
        totalGroups: 2, cachedGroups: 2,
        totalInputTokens: 50000, actualInputTokens: 0,
        totalOutputTokens: 400, actualOutputTokens: 0,
        totalCost: 0.156, actualCost: 0,
        totalReviewSkills: 2, cachedReviewSkills: 2,
      });
      assert.ok(allCached.includes("Cached skills: 2/2"));
      assert.ok(allCached.includes("$0.00"));

      // No cache
      const noneDisplay = buildCostPreviewDisplay({
        totalGroups: 2, cachedGroups: 0,
        totalInputTokens: 80000, actualInputTokens: 80000,
        totalOutputTokens: 600, actualOutputTokens: 600,
        totalCost: 0.249, actualCost: 0.249,
      });
      assert.ok(!noneDisplay.includes("Cached skills"));
      assert.ok(!noneDisplay.includes("Actual estimated cost"));
    });
  });

  describe("token budget regression", () => {
    // Fixed fixture: a repo with TypeScript, React, and Docker skills
    // TypeScript and React share .tsx files -> should be grouped
    // Docker is independent
    const TSX_CONTENT = "import React from 'react';\n".repeat(80); // 80 lines
    const TS_CONTENT = "export function add(a: number, b: number): number { return a + b; }\n".repeat(60);
    const LONG_FILE = "const x = 1;\n".repeat(200); // exceeds 150-line truncation
    const DOCKERFILE = "FROM node:22\nWORKDIR /app\nCOPY . .\nRUN npm install\n";

    const FIXTURE_FILES: Record<string, FileForReview[]> = {
      TypeScript: [
        { path: "src/App.tsx", content: TSX_CONTENT, ownership: 0.9, skill: "TypeScript" },
        { path: "src/utils.ts", content: TS_CONTENT, ownership: 0.85, skill: "TypeScript" },
        { path: "src/long.ts", content: LONG_FILE, ownership: 0.7, skill: "TypeScript" },
      ],
      React: [
        { path: "src/App.tsx", content: TSX_CONTENT, ownership: 0.9, skill: "React" },
        { path: "src/Component.tsx", content: TSX_CONTENT, ownership: 0.8, skill: "React" },
      ],
      Docker: [
        { path: "Dockerfile", content: DOCKERFILE, ownership: 1.0, skill: "Docker" },
      ],
    };

    it("truncation produces stable token counts", () => {
      // 80-line file: no truncation
      const tsxTokens = estimateTokens(truncateFileContent(TSX_CONTENT));
      assert.equal(tsxTokens, 540);

      // 60-line file: no truncation
      const tsTokens = estimateTokens(truncateFileContent(TS_CONTENT));
      assert.equal(tsTokens, 1020);

      // 200-line file: truncated to 150 lines + "// ... truncated"
      const longTokens = estimateTokens(truncateFileContent(LONG_FILE));
      assert.equal(longTokens, 492);

      // Short file: no truncation
      const dockerTokens = estimateTokens(truncateFileContent(DOCKERFILE));
      assert.equal(dockerTokens, 13);
    });

    it("skill grouping produces expected groups", () => {
      const skillFiles = new Map<string, string[]>();
      skillFiles.set("TypeScript", ["src/App.tsx", "src/utils.ts", "src/long.ts"]);
      skillFiles.set("React", ["src/App.tsx", "src/Component.tsx"]);
      skillFiles.set("Docker", ["Dockerfile"]);

      const groups = groupSkillsByFileOverlap(skillFiles, 0.5);

      // TypeScript and React share App.tsx (1/3 for TS, 1/2 for React >= 50%)
      assert.equal(groups.length, 2);
      const tsGroup = groups.find(g => g.skills.includes("TypeScript"))!;
      assert.ok(tsGroup.skills.includes("React"));
      // Deduplicated files: App.tsx, utils.ts, long.ts, Component.tsx
      assert.equal(tsGroup.files.length, 4);

      const dockerGroup = groups.find(g => g.skills.includes("Docker"))!;
      assert.equal(dockerGroup.skills.length, 1);
      assert.equal(dockerGroup.files.length, 1);
    });

    it("end-to-end cost estimate matches expected values", () => {
      // Simulate the infer.ts cost preview pipeline:
      // 1. Truncate files and sum tokens per group
      // 2. Compute cost with OUTPUT_TOKENS_PER_SKILL = 200 per skill

      const OUTPUT_TOKENS_PER_SKILL = 200;

      // Group 1: TypeScript+React — 4 unique files
      const group1Files = [TSX_CONTENT, TS_CONTENT, LONG_FILE, TSX_CONTENT]; // App.tsx, utils.ts, long.ts, Component.tsx
      const group1Tokens = group1Files.reduce(
        (sum, content) => sum + estimateTokens(truncateFileContent(content)), 0
      );
      // Group 2: Docker — 1 file
      const group2Tokens = estimateTokens(truncateFileContent(DOCKERFILE));

      const totalInputTokens = group1Tokens + group2Tokens;
      const totalSkills = 3; // TypeScript, React, Docker
      const totalOutputTokens = totalSkills * OUTPUT_TOKENS_PER_SKILL;
      const totalCost = estimateCost(totalInputTokens, totalOutputTokens);

      // Snapshot assertions — if any formula changes, these fail
      assert.equal(group1Tokens, 2592); // 540 + 1020 + 492 + 540
      assert.equal(group2Tokens, 13);
      assert.equal(totalInputTokens, 2605);
      assert.equal(totalOutputTokens, 600);
      assert.ok(Math.abs(totalCost - 0.016815) < 0.000001, `Cost $${totalCost} != expected $0.016815`);

      // Verify cost stays under $0.02 for this fixture (sanity bound)
      assert.ok(totalCost < 0.02, `Cost $${totalCost} exceeds $0.02 budget for fixture`);
    });

    it("50K per-skill budget is not exceeded by fixture", () => {
      const TOKEN_BUDGET_PER_SKILL = 50_000;

      // Largest group: TypeScript+React (2 skills) -> budget = 100K
      const group1Budget = TOKEN_BUDGET_PER_SKILL * 2;
      const group1Tokens = [TSX_CONTENT, TS_CONTENT, LONG_FILE, TSX_CONTENT].reduce(
        (sum, content) => sum + estimateTokens(truncateFileContent(content)), 0
      );
      assert.ok(group1Tokens < group1Budget,
        `Group tokens ${group1Tokens} exceed budget ${group1Budget}`);

      // Docker group: 1 skill -> budget = 50K
      const dockerTokens = estimateTokens(truncateFileContent(DOCKERFILE));
      assert.ok(dockerTokens < TOKEN_BUDGET_PER_SKILL,
        `Docker tokens ${dockerTokens} exceed budget ${TOKEN_BUDGET_PER_SKILL}`);
    });
  });
});
