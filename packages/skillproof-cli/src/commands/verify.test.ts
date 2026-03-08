import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyBundle } from "./verify.ts";
import { createEmptyManifest, writeManifest } from "../core/manifest.ts";
import { generateKeyPair, signManifest } from "./sign.ts";
import { canonicalJson, hashContent } from "../core/hashing.ts";
import { runPack } from "./pack.ts";
import type { Signature } from "../types/manifest.ts";

describe("verify", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-verify-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("verifies a valid bundle", async () => {
    const resumeContent = "# Test\n";
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });

    // Write resume file and compute file_hashes into manifest before signing
    await writeFile(path.join(tempDir, "resume.md"), resumeContent, "utf8");
    manifest.file_hashes = {
      "resume.md": hashContent(resumeContent),
    };

    const keysDir = path.join(tempDir, ".skillproof", "keys");
    const keys = await generateKeyPair(keysDir);

    const manifestForSign = { ...manifest, signatures: [] as Signature[] };
    const content = canonicalJson(manifestForSign);
    const sig = signManifest(content, keys.privateKey);
    manifest.signatures = [{
      signer: "candidate",
      public_key: Buffer.from(keys.publicKey).toString("base64"),
      signature: sig,
      timestamp: new Date().toISOString(),
      algorithm: "Ed25519",
    }];

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);

    await runPack(tempDir);

    const bundlePath = path.join(tempDir, "bundle.zip");
    const result = await verifyBundle(bundlePath);
    assert.equal(result.valid, true);
    assert.equal(result.signatures.length, 1);
    assert.equal(result.signatures[0].valid, true);
    assert.equal(result.resumeTampered, false);
  });

  it("detects tampered resume.md", async () => {
    const resumeContent = "# Original\n";
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });

    await writeFile(path.join(tempDir, "resume.md"), resumeContent, "utf8");
    manifest.file_hashes = {
      "resume.md": hashContent(resumeContent),
    };

    const keysDir = path.join(tempDir, ".skillproof", "keys");
    const keys = await generateKeyPair(keysDir);

    const manifestForSign = { ...manifest, signatures: [] as Signature[] };
    const content = canonicalJson(manifestForSign);
    const sig = signManifest(content, keys.privateKey);
    manifest.signatures = [{
      signer: "candidate",
      public_key: Buffer.from(keys.publicKey).toString("base64"),
      signature: sig,
      timestamp: new Date().toISOString(),
      algorithm: "Ed25519",
    }];

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);

    await runPack(tempDir);

    // Tamper with resume.md inside the bundle
    const bundlePath = path.join(tempDir, "bundle.zip");
    const tamperDir = await mkdtemp(path.join(tmpdir(), "skillproof-tamper-"));

    const { execFile: ef } = await import("node:child_process");
    const { promisify: p } = await import("node:util");
    const execFileAsync = p(ef);

    await execFileAsync("unzip", ["-o", bundlePath, "-d", tamperDir]);
    await writeFile(path.join(tamperDir, "resume.md"), "# TAMPERED\n", "utf8");

    // Re-zip
    await rm(bundlePath);
    await execFileAsync("zip", ["-j", bundlePath,
      path.join(tamperDir, "resume.md"),
      path.join(tamperDir, "resume-manifest.json"),
      path.join(tamperDir, "verification.json"),
    ]);
    await rm(tamperDir, { recursive: true });

    const result = await verifyBundle(bundlePath);
    assert.equal(result.valid, false);
    assert.equal(result.resumeTampered, true);
  });

  it("detects simultaneous tamper of resume and verification.json", async () => {
    const resumeContent = "# Original\n";
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });

    await writeFile(path.join(tempDir, "resume.md"), resumeContent, "utf8");
    manifest.file_hashes = {
      "resume.md": hashContent(resumeContent),
    };

    const keysDir = path.join(tempDir, ".skillproof", "keys");
    const keys = await generateKeyPair(keysDir);

    const manifestForSign = { ...manifest, signatures: [] as Signature[] };
    const content = canonicalJson(manifestForSign);
    const sig = signManifest(content, keys.privateKey);
    manifest.signatures = [{
      signer: "candidate",
      public_key: Buffer.from(keys.publicKey).toString("base64"),
      signature: sig,
      timestamp: new Date().toISOString(),
      algorithm: "Ed25519",
    }];

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);

    await runPack(tempDir);

    // Tamper BOTH resume.md AND verification.json with matching fake hash
    const bundlePath = path.join(tempDir, "bundle.zip");
    const tamperDir = await mkdtemp(path.join(tmpdir(), "skillproof-tamper-"));

    const { execFile: ef } = await import("node:child_process");
    const { promisify: p } = await import("node:util");
    const execFileAsync = p(ef);

    await execFileAsync("unzip", ["-o", bundlePath, "-d", tamperDir]);

    const tamperedResume = "# TAMPERED CONTENT\n";
    await writeFile(path.join(tamperDir, "resume.md"), tamperedResume, "utf8");

    // Also update verification.json so its hash matches the tampered file
    const tamperedVerification = {
      instructions: "To verify this resume bundle, use: skillproof verify bundle.zip",
      manifest_hash: "fake",
      resume_hash: hashContent(tamperedResume),
      file_hashes: { "resume.md": hashContent(tamperedResume) },
      signature_count: 1,
      generated_at: new Date().toISOString(),
    };
    await writeFile(
      path.join(tamperDir, "verification.json"),
      JSON.stringify(tamperedVerification, null, 2),
      "utf8",
    );

    // Re-zip with tampered files (manifest unchanged — signature still valid)
    await rm(bundlePath);
    await execFileAsync("zip", ["-j", bundlePath,
      path.join(tamperDir, "resume.md"),
      path.join(tamperDir, "resume-manifest.json"),
      path.join(tamperDir, "verification.json"),
    ]);
    await rm(tamperDir, { recursive: true });

    // file_hashes in signed manifest still points to original hash → INVALID
    const result = await verifyBundle(bundlePath);
    assert.equal(result.valid, false, "should be invalid when resume + verification.json are both tampered");
    assert.equal(result.resumeTampered, true);
    assert.ok(result.tamperedFiles.includes("resume.md"));
  });

  it("fails when manifest has no file_hashes but resume files exist", async () => {
    // Simulates split-step CLI flow where sign was run before render
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });
    // No file_hashes set — signing without resume files present

    const keysDir = path.join(tempDir, ".skillproof", "keys");
    const keys = await generateKeyPair(keysDir);

    const manifestForSign = { ...manifest, signatures: [] as Signature[] };
    const content = canonicalJson(manifestForSign);
    const sig = signManifest(content, keys.privateKey);
    manifest.signatures = [{
      signer: "candidate",
      public_key: Buffer.from(keys.publicKey).toString("base64"),
      signature: sig,
      timestamp: new Date().toISOString(),
      algorithm: "Ed25519",
    }];

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);

    // Create resume file AFTER signing (not covered by signature)
    await writeFile(path.join(tempDir, "resume.md"), "# Resume\n", "utf8");

    await runPack(tempDir);

    const bundlePath = path.join(tempDir, "bundle.zip");
    const result = await verifyBundle(bundlePath);
    assert.equal(result.valid, false, "should be invalid when file_hashes missing");
    assert.equal(result.resumeTampered, true);
    assert.equal(result.fileHashesMissing, true);
    assert.ok(result.tamperedFiles.includes("resume.md"));
  });
});
