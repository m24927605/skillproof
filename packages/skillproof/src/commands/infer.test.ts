import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeManifest, readManifest, createEmptyManifest } from "../core/manifest.ts";
import { detectSkillEvidence } from "../core/skills.ts";

describe("infer", () => {
  let tempDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-test-"));
    manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("detects skills from evidence in manifest", async () => {
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });
    manifest.evidence = [
      {
        id: "EV-CONFIG-abc",
        type: "config",
        hash: "abc",
        timestamp: "2025-01-01T00:00:00Z",
        ownership: 1.0,
        source: "Dockerfile",
      },
      {
        id: "EV-DEP-redis",
        type: "dependency",
        hash: "def",
        timestamp: "2025-01-01T00:00:00Z",
        ownership: 1.0,
        source: "package.json",
      },
    ];
    await writeManifest(manifestPath, manifest);

    const saved = await readManifest(manifestPath);
    const skillEvidence = detectSkillEvidence(saved.evidence);
    assert.ok(skillEvidence.size >= 2);
    assert.ok(skillEvidence.has("Docker"));
    assert.ok(skillEvidence.has("Redis"));
  });

  it("collectFilesForReview returns files sorted by ownership descending", async () => {
    const { collectFilesForReview } = await import("./infer.ts");

    const evidence = [
      { id: "EV-FILE-a", type: "file" as const, hash: "a", timestamp: "2026-01-01T00:00:00Z", ownership: 0.3, source: "low.ts" },
      { id: "EV-FILE-b", type: "file" as const, hash: "b", timestamp: "2026-01-01T00:00:00Z", ownership: 0.9, source: "high.ts" },
      { id: "EV-FILE-c", type: "file" as const, hash: "c", timestamp: "2026-01-01T00:00:00Z", ownership: 0.7, source: "mid.ts" },
      { id: "EV-COMMIT-d", type: "commit" as const, hash: "d", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "abc" },
    ];
    const evidenceIds = evidence.map((e) => e.id);

    const files = collectFilesForReview(evidence, evidenceIds);
    assert.equal(files.length, 3); // only file type
    assert.equal(files[0].source, "high.ts"); // highest ownership first
    assert.equal(files[1].source, "mid.ts");
    assert.equal(files[2].source, "low.ts");
  });

  it("Skill type accepts strengths and reasoning fields", async () => {
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });
    manifest.skills = [
      {
        name: "TypeScript",
        confidence: 0.85,
        evidence_ids: ["EV-1"],
        inferred_by: "llm",
        strengths: ["Good type safety"],
        reasoning: "Solid TypeScript usage",
      },
    ];
    await writeManifest(manifestPath, manifest);
    const saved = await readManifest(manifestPath);
    assert.deepEqual(saved.skills[0].strengths, ["Good type safety"]);
    assert.equal(saved.skills[0].reasoning, "Solid TypeScript usage");
  });

  it("splitFilesIntoBatches limits each batch by input tokens", async () => {
    const { splitFilesIntoBatches } = await import("./infer.ts");

    const files = [
      { path: "a.ts", content: "a".repeat(40000), ownership: 1, skill: "TypeScript" },
      { path: "b.ts", content: "b".repeat(40000), ownership: 1, skill: "TypeScript" },
      { path: "c.ts", content: "c".repeat(40000), ownership: 1, skill: "TypeScript" },
    ];

    const batches = splitFilesIntoBatches(files, 25_000);
    assert.equal(batches.length, 2);
    assert.deepEqual(batches.map((batch) => batch.map((file) => file.path)), [["a.ts", "b.ts"], ["c.ts"]]);
  });

  it("mergeReviewResults averages scores and deduplicates strengths", async () => {
    const { mergeReviewResults } = await import("./infer.ts");

    const merged = mergeReviewResults("Go", [
      {
        skill: "Go",
        quality_score: 0.8,
        reasoning: "Strong API boundaries.",
        strengths: ["Interfaces", "Testing"],
      },
      {
        skill: "Go",
        quality_score: 0.6,
        reasoning: "Good error handling.",
        strengths: ["Testing", "Error wrapping"],
      },
    ]);

    assert.equal(merged.skill, "Go");
    assert.equal(merged.quality_score, 0.7);
    assert.equal(merged.reasoning, "Strong API boundaries. Good error handling.");
    assert.deepEqual(merged.strengths, ["Interfaces", "Testing", "Error wrapping"]);
  });
});
