import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, estimateCost, truncateFileContent, buildEstimateDisplay, buildCostPreviewDisplay } from "./token-estimate.ts";
import type { FileForReview } from "./token-estimate.ts";
import { groupSkillsByFileOverlap } from "./skill-grouping.ts";
import { buildEvidenceDigest } from "./evidence-digest.ts";
import { analyzeStaticQuality } from "./static-quality.ts";
import type { Evidence } from "../types/manifest.ts";

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

    it("end-to-end digest-based cost estimate matches expected values", () => {
      // Simulate the infer.ts cost preview pipeline (digest-based):
      // 1. Build digests from evidence + file contents
      // 2. Estimate tokens from digest payload (summary lines + snippet blocks)
      // 3. Compute cost with OUTPUT_TOKENS_PER_SKILL = 200 per skill

      const OUTPUT_TOKENS_PER_SKILL = 200;

      // Build file contents cache (truncated, as infer.ts does)
      const fileContentsCache = new Map<string, string>();
      fileContentsCache.set("src/App.tsx", truncateFileContent(TSX_CONTENT));
      fileContentsCache.set("src/utils.ts", truncateFileContent(TS_CONTENT));
      fileContentsCache.set("src/long.ts", truncateFileContent(LONG_FILE));
      fileContentsCache.set("src/Component.tsx", truncateFileContent(TSX_CONTENT));
      fileContentsCache.set("Dockerfile", truncateFileContent(DOCKERFILE));

      // Build evidence for each skill
      const tsEvidence: Evidence[] = [
        { id: "EV-FILE-1", type: "file", hash: "a", timestamp: "t", ownership: 0.9, source: "src/App.tsx" },
        { id: "EV-FILE-2", type: "file", hash: "b", timestamp: "t", ownership: 0.85, source: "src/utils.ts" },
        { id: "EV-FILE-3", type: "file", hash: "c", timestamp: "t", ownership: 0.7, source: "src/long.ts" },
      ];
      const reactEvidence: Evidence[] = [
        { id: "EV-FILE-4", type: "file", hash: "d", timestamp: "t", ownership: 0.9, source: "src/App.tsx" },
        { id: "EV-FILE-5", type: "file", hash: "e", timestamp: "t", ownership: 0.8, source: "src/Component.tsx" },
      ];
      const dockerEvidence: Evidence[] = [
        { id: "EV-CONFIG-1", type: "config", hash: "f", timestamp: "t", ownership: 1.0, source: "Dockerfile" },
      ];

      // Build digests (as infer.ts does during pre-compute)
      const tsDigest = buildEvidenceDigest("TypeScript", tsEvidence, analyzeStaticQuality("TypeScript", tsEvidence), fileContentsCache);
      const reactDigest = buildEvidenceDigest("React", reactEvidence, analyzeStaticQuality("React", reactEvidence), fileContentsCache);
      const dockerDigest = buildEvidenceDigest("Docker", dockerEvidence, analyzeStaticQuality("Docker", dockerEvidence), fileContentsCache);

      // Estimate tokens from digest payloads (matching infer.ts logic)
      function digestTokens(d: typeof tsDigest): number {
        const text = d.summaryLines.join("\n") + d.snippetBlocks.map((b) => b.content).join("\n");
        return estimateTokens(text);
      }

      const tsTokens = digestTokens(tsDigest);
      const reactTokens = digestTokens(reactDigest);
      const dockerTokens = digestTokens(dockerDigest);

      const totalInputTokens = tsTokens + reactTokens + dockerTokens;
      const totalSkills = 3;
      const totalOutputTokens = totalSkills * OUTPUT_TOKENS_PER_SKILL;
      const totalCost = estimateCost(totalInputTokens, totalOutputTokens);

      // Digest tokens should be much smaller than raw file tokens
      // (digest caps at 5 snippets * 2000 chars each = ~2500 tokens max per skill)
      assert.ok(tsTokens > 0, "TypeScript digest should have tokens");
      assert.ok(reactTokens > 0, "React digest should have tokens");
      assert.ok(totalInputTokens < 10000, `Digest tokens ${totalInputTokens} should be well under 10K`);

      // Cost should be very low for this fixture
      assert.ok(totalCost < 0.05, `Cost $${totalCost} exceeds $0.05 for fixture`);
    });

    it("digest payload is bounded by MAX_SNIPPETS and MAX_SNIPPET_CHARS", () => {
      // Even with many large files, digest is bounded
      const fileContents = new Map<string, string>();
      const evidence: Evidence[] = [];
      for (let i = 0; i < 20; i++) {
        const path = `src/file${i}.ts`;
        fileContents.set(path, "x".repeat(5000)); // large files
        evidence.push({ id: `EV-FILE-${i}`, type: "file", hash: `h${i}`, timestamp: "t", ownership: 0.9, source: path });
      }

      const digest = buildEvidenceDigest("TypeScript", evidence, analyzeStaticQuality("TypeScript", evidence), fileContents);

      // MAX_SNIPPETS = 5
      assert.ok(digest.snippetBlocks.length <= 5, `Snippets ${digest.snippetBlocks.length} should be <= 5`);

      // Each snippet is bounded by MAX_SNIPPET_CHARS = 2000
      for (const block of digest.snippetBlocks) {
        assert.ok(block.content.length <= 2000, `Snippet ${block.path} is ${block.content.length} chars, should be <= 2000`);
      }

      // Total digest tokens should be well-bounded
      const text = digest.summaryLines.join("\n") + digest.snippetBlocks.map((b) => b.content).join("\n");
      const tokens = estimateTokens(text);
      assert.ok(tokens < 3000, `Digest tokens ${tokens} should be < 3000 (5 snippets * 500 tokens + overhead)`);
    });
  });
});
