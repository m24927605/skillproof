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
    tempDir = await mkdtemp(path.join(tmpdir(), "veriresume-test-"));
    manifestPath = path.join(tempDir, ".veriresume", "resume-manifest.json");
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
});
