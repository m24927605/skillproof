import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeStaticQuality } from "./static-quality.ts";
import type { Evidence } from "../types/manifest.ts";

function makeEvidence(overrides: Partial<Evidence> & { id: string; type: Evidence["type"]; source: string }): Evidence {
  return {
    hash: "abc",
    timestamp: "2026-01-01T00:00:00Z",
    ownership: 1.0,
    ...overrides,
  };
}

describe("analyzeStaticQuality", () => {
  it("returns higher score when tests are present", () => {
    const withTests = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts" }),
      makeEvidence({ id: "EV-FILE-2", type: "file", source: "src/app.test.ts" }),
    ]);
    const withoutTests = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts" }),
    ]);
    assert.ok(withTests.score > withoutTests.score, `with tests (${withTests.score}) should be > without (${withoutTests.score})`);
    assert.ok(withTests.signals.test_file_count > 0);
  });

  it("returns higher score when lint/type/CI signals are present", () => {
    const withSignals = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts" }),
      makeEvidence({ id: "EV-CONFIG-1", type: "config", source: "tsconfig.json" }),
      makeEvidence({ id: "EV-CONFIG-2", type: "config", source: ".github/workflows/ci.yml" }),
      makeEvidence({ id: "EV-CONFIG-3", type: "config", source: ".eslintrc.json" }),
    ]);
    const withoutSignals = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts" }),
    ]);
    assert.ok(withSignals.score > withoutSignals.score, `with signals (${withSignals.score}) should be > without (${withoutSignals.score})`);
    assert.ok(withSignals.signals.has_ci);
    assert.ok(withSignals.signals.has_lint);
    assert.ok(withSignals.signals.has_types);
  });

  it("returns conservative score when only dependency/config evidence exists", () => {
    const depOnly = analyzeStaticQuality("Redis", [
      makeEvidence({ id: "EV-DEP-redis", type: "dependency", source: "package.json" }),
    ]);
    const codeBacked = analyzeStaticQuality("Redis", [
      makeEvidence({ id: "EV-DEP-redis", type: "dependency", source: "package.json" }),
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/cache.ts", ownership: 0.9 }),
      makeEvidence({ id: "EV-FILE-2", type: "file", source: "src/cache.test.ts", ownership: 0.8 }),
    ]);
    assert.ok(depOnly.score < codeBacked.score, `dep-only (${depOnly.score}) should be < code-backed (${codeBacked.score})`);
    assert.ok(depOnly.score <= 0.5, `dep-only score (${depOnly.score}) should be capped conservatively`);
  });

  it("dependency-only skill receives valid static_confidence without file content", () => {
    const result = analyzeStaticQuality("Express", [
      makeEvidence({ id: "EV-DEP-express", type: "dependency", source: "package.json" }),
    ]);
    assert.ok(result.score > 0, "score should be positive");
    assert.ok(result.score <= 1, "score should be <= 1");
    assert.ok(result.reasons.length > 0, "should have at least one reason");
    assert.equal(result.signals.dependency_count, 1);
    assert.equal(result.signals.file_count, 0);
  });

  it("commit/PR evidence supplements score", () => {
    const withCommits = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts" }),
      makeEvidence({ id: "EV-COMMIT-1", type: "commit", source: "abc123" }),
      makeEvidence({ id: "EV-COMMIT-2", type: "commit", source: "def456" }),
      makeEvidence({ id: "EV-PR-1", type: "pull_request", source: "PR #42" }),
    ]);
    const withoutCommits = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts" }),
    ]);
    assert.ok(withCommits.score >= withoutCommits.score, `with commits (${withCommits.score}) should be >= without (${withoutCommits.score})`);
    assert.equal(withCommits.signals.commit_count, 2);
    assert.equal(withCommits.signals.pr_count, 1);
  });

  it("score is always clamped to 0..1", () => {
    // Maximally evidence-rich skill
    const result = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts", ownership: 1.0 }),
      makeEvidence({ id: "EV-FILE-2", type: "file", source: "src/app.test.ts", ownership: 1.0 }),
      makeEvidence({ id: "EV-FILE-3", type: "file", source: "src/utils.ts", ownership: 0.9 }),
      makeEvidence({ id: "EV-CONFIG-1", type: "config", source: "tsconfig.json" }),
      makeEvidence({ id: "EV-CONFIG-2", type: "config", source: ".eslintrc.json" }),
      makeEvidence({ id: "EV-CONFIG-3", type: "config", source: ".github/workflows/ci.yml" }),
      makeEvidence({ id: "EV-DEP-1", type: "dependency", source: "package.json" }),
      makeEvidence({ id: "EV-COMMIT-1", type: "commit", source: "abc" }),
      makeEvidence({ id: "EV-COMMIT-2", type: "commit", source: "def" }),
      makeEvidence({ id: "EV-COMMIT-3", type: "commit", source: "ghi" }),
      makeEvidence({ id: "EV-PR-1", type: "pull_request", source: "PR #1" }),
      makeEvidence({ id: "EV-PR-2", type: "pull_request", source: "PR #2" }),
    ]);
    assert.ok(result.score >= 0, `score (${result.score}) should be >= 0`);
    assert.ok(result.score <= 1, `score (${result.score}) should be <= 1`);

    // Minimal evidence
    const minimal = analyzeStaticQuality("Unknown", []);
    assert.ok(minimal.score >= 0, `minimal score (${minimal.score}) should be >= 0`);
    assert.ok(minimal.score <= 1, `minimal score (${minimal.score}) should be <= 1`);
  });

  it("snippet evidence is treated as lightweight file evidence", () => {
    const result = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-SNIPPET-1", type: "snippet", source: "src/handler.ts:10-25" }),
    ]);
    assert.equal(result.signals.snippet_count, 1);
    assert.ok(result.score > 0);
  });

  it("ownership-weighted file count affects score", () => {
    const highOwnership = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts", ownership: 1.0 }),
      makeEvidence({ id: "EV-FILE-2", type: "file", source: "src/utils.ts", ownership: 0.9 }),
    ]);
    const lowOwnership = analyzeStaticQuality("TypeScript", [
      makeEvidence({ id: "EV-FILE-1", type: "file", source: "src/app.ts", ownership: 0.1 }),
      makeEvidence({ id: "EV-FILE-2", type: "file", source: "src/utils.ts", ownership: 0.1 }),
    ]);
    assert.ok(highOwnership.score > lowOwnership.score, `high ownership (${highOwnership.score}) should be > low (${lowOwnership.score})`);
  });
});
