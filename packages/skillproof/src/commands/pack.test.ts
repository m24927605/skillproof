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
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-test-"));
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

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);
    await writeFile(path.join(tempDir, "resume.md"), "# Test Resume\n", "utf8");

    await runPack(tempDir);

    const files = await readdir(tempDir);
    assert.ok(files.includes("bundle.zip"), "bundle.zip should exist");
  });

  it("includes rendered resume files (pdf) in bundle", async () => {
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);
    await writeFile(path.join(tempDir, "resume.md"), "# Test Resume\n", "utf8");
    await writeFile(path.join(tempDir, "resume.pdf"), "fake-pdf-content", "utf8");

    await runPack(tempDir);

    const { execFile: ef } = await import("node:child_process");
    const { promisify: p } = await import("node:util");
    const execFileAsync = p(ef);
    const { mkdir: mkdirFs } = await import("node:fs/promises");

    const extractDir = path.join(tempDir, "extracted");
    await mkdirFs(extractDir, { recursive: true });
    await execFileAsync("unzip", ["-o", path.join(tempDir, "bundle.zip"), "-d", extractDir]);

    const files = await readdir(extractDir);
    assert.ok(files.includes("resume.md"));
    assert.ok(files.includes("resume.pdf"));
  });

  it("creates bundle.zip in outputDir when specified", async () => {
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);

    // Put resume file in a separate output directory
    const outDir = await mkdtemp(path.join(tmpdir(), "skillproof-packout-"));
    await writeFile(path.join(outDir, "resume.md"), "# Test Resume\n", "utf8");

    try {
      await runPack(tempDir, outDir);

      const outFiles = await readdir(outDir);
      assert.ok(outFiles.includes("bundle.zip"), "bundle.zip should be in outputDir");

      const cwdFiles = await readdir(tempDir);
      assert.ok(!cwdFiles.includes("bundle.zip"), "bundle.zip should NOT be in cwd");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("sign --output-dir + pack --output-dir produces a valid bundle", async () => {
    const { runSign } = await import("./sign.ts");
    const { verifyBundle } = await import("./verify.ts");

    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);

    // Resume lives in a separate output directory
    const outDir = await mkdtemp(path.join(tmpdir(), "skillproof-signpack-"));
    await writeFile(path.join(outDir, "resume.md"), "# Test Resume\n", "utf8");

    try {
      // Simulate: sign --output-dir out → pack --output-dir out
      await runSign(tempDir, outDir);
      await runPack(tempDir, outDir);

      const result = await verifyBundle(path.join(outDir, "bundle.zip"));
      assert.ok(result.valid, `bundle should be VALID but got INVALID (fileHashesMissing: ${result.fileHashesMissing}, tampered: ${result.tamperedFiles.join(", ")})`);
      assert.ok(!result.fileHashesMissing, "manifest should contain file_hashes");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("throws when no resume file exists", async () => {
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);
    // No resume.md created

    await assert.rejects(() => runPack(tempDir), /No resume file found/);
  });
});
