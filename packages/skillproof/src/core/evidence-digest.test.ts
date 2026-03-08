import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceDigest } from "./evidence-digest.ts";
import type { Evidence } from "../types/manifest.ts";
import type { StaticQualityResult } from "./static-quality.ts";

function makeEvidence(overrides: Partial<Evidence> & { id: string; type: Evidence["type"]; source: string }): Evidence {
  return {
    hash: "abc",
    timestamp: "2026-01-01T00:00:00Z",
    ownership: 1.0,
    ...overrides,
  };
}

function makeStaticResult(overrides?: Partial<StaticQualityResult>): StaticQualityResult {
  return {
    score: 0.5,
    reasons: ["2 file(s), 0 snippet(s)"],
    signals: {
      file_count: 2, owned_file_count: 2, test_file_count: 0,
      config_file_count: 0, dependency_count: 0, config_evidence_count: 0,
      commit_count: 0, pr_count: 0, snippet_count: 0,
      has_ci: false, has_lint: false, has_types: false,
      has_error_handling: false, has_validation: false,
    },
    ...overrides,
  };
}

describe("buildEvidenceDigest", () => {
  it("prefers high-ownership files", () => {
    const evidence: Evidence[] = [
      makeEvidence({ id: "EV-FILE-low", type: "file", source: "vendor/lib.ts", ownership: 0.1 }),
      makeEvidence({ id: "EV-FILE-high", type: "file", source: "src/core.ts", ownership: 0.95 }),
      makeEvidence({ id: "EV-FILE-mid", type: "file", source: "src/utils.ts", ownership: 0.6 }),
    ];
    const fileContents = new Map([
      ["vendor/lib.ts", "export const x = 1;"],
      ["src/core.ts", "export function main() { return 42; }"],
      ["src/utils.ts", "export function helper() { return true; }"],
    ]);

    const digest = buildEvidenceDigest("TypeScript", evidence, makeStaticResult(), fileContents);

    // First snippet should be the highest-ownership file
    assert.ok(digest.snippetBlocks.length > 0);
    assert.equal(digest.snippetBlocks[0].path, "src/core.ts");
  });

  it("includes static summary lines", () => {
    const evidence: Evidence[] = [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts" }),
      makeEvidence({ id: "EV-FILE-2", type: "file", source: "src/app.test.ts" }),
      makeEvidence({ id: "EV-CONFIG-1", type: "config", source: "tsconfig.json" }),
    ];
    const staticResult = makeStaticResult({
      reasons: ["2 file(s), 0 snippet(s)", "1 test file(s)", "Type checking configured"],
      signals: {
        file_count: 2, owned_file_count: 2, test_file_count: 1,
        config_file_count: 0, dependency_count: 0, config_evidence_count: 1,
        commit_count: 0, pr_count: 0, snippet_count: 0,
        has_ci: false, has_lint: false, has_types: true,
        has_error_handling: false, has_validation: false,
      },
    });

    const digest = buildEvidenceDigest("TypeScript", evidence, staticResult, new Map());
    assert.ok(digest.summaryLines.length > 0);
    // Should include file count and static signal info
    const summaryText = digest.summaryLines.join(" ");
    assert.ok(summaryText.includes("2"), "should mention file count");
  });

  it("limits snippet size and count", () => {
    const evidence: Evidence[] = [];
    const fileContents = new Map<string, string>();
    for (let i = 0; i < 20; i++) {
      const source = `src/file${i}.ts`;
      evidence.push(makeEvidence({ id: `EV-FILE-${i}`, type: "file", source, ownership: 0.9 }));
      fileContents.set(source, "x".repeat(5000));
    }

    const digest = buildEvidenceDigest("TypeScript", evidence, makeStaticResult({ signals: {
      ...makeStaticResult().signals,
      file_count: 20, owned_file_count: 20,
    }}), fileContents);

    // Should not include all 20 files as snippets
    assert.ok(digest.snippetBlocks.length <= 5, `snippet count (${digest.snippetBlocks.length}) should be <= 5`);
    // Each snippet should be truncated
    for (const block of digest.snippetBlocks) {
      assert.ok(block.content.length <= 2000, `snippet length (${block.content.length}) should be <= 2000`);
    }
  });

  it("handles skills with no file contents gracefully", () => {
    const evidence: Evidence[] = [
      makeEvidence({ id: "EV-DEP-1", type: "dependency", source: "package.json" }),
    ];
    const staticResult = makeStaticResult({
      reasons: ["1 dependency(ies), 0 config(s)"],
      signals: {
        ...makeStaticResult().signals,
        file_count: 0, owned_file_count: 0, dependency_count: 1,
      },
    });

    const digest = buildEvidenceDigest("Express", evidence, staticResult, new Map());
    assert.ok(digest.summaryLines.length > 0);
    assert.equal(digest.snippetBlocks.length, 0);
  });

  it("includes dependency and config info in summary", () => {
    const evidence: Evidence[] = [
      makeEvidence({ id: "EV-DEP-1", type: "dependency", source: "package.json" }),
      makeEvidence({ id: "EV-CONFIG-1", type: "config", source: ".github/workflows/ci.yml" }),
    ];
    const staticResult = makeStaticResult({
      signals: {
        ...makeStaticResult().signals,
        file_count: 0, dependency_count: 1, config_evidence_count: 1, has_ci: true,
      },
    });

    const digest = buildEvidenceDigest("Express", evidence, staticResult, new Map());
    const summaryText = digest.summaryLines.join(" ");
    assert.ok(summaryText.toLowerCase().includes("dependency") || summaryText.toLowerCase().includes("dep"), "should mention dependency");
  });
});
