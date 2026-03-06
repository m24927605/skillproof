import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPack } from "./pack.ts";
import { createEmptyManifest, writeManifest } from "../core/manifest.ts";

describe("pack", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "veriresume-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("creates a bundle.zip file", async () => {
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });
    manifest.signatures = [{
      signer: "candidate",
      public_key: "dGVzdA==",
      signature: "c2lnbmF0dXJl",
      timestamp: "2025-01-01T00:00:00Z",
      algorithm: "Ed25519",
    }];

    const manifestPath = path.join(tempDir, ".veriresume", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);
    await writeFile(path.join(tempDir, "resume.md"), "# Test Resume\n", "utf8");

    await runPack(tempDir);

    const files = await readdir(tempDir);
    assert.ok(files.includes("bundle.zip"), "bundle.zip should exist");
  });
});
