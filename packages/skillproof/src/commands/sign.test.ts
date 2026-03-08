import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPair, signManifest, verifySignature, runSign } from "./sign.ts";

describe("sign", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("generateKeyPair", () => {
    it("generates Ed25519 key pair files", async () => {
      const keys = await generateKeyPair(tempDir);
      assert.ok(keys.publicKey.length > 0);
      assert.ok(keys.privateKey.length > 0);
    });
  });

  describe("signManifest / verifySignature", () => {
    it("signs a manifest and verifies the signature", async () => {
      const keys = await generateKeyPair(tempDir);
      const manifestContent = '{"schema_version":"1.0","evidence":[]}';

      const signature = signManifest(manifestContent, keys.privateKey);
      assert.ok(signature.length > 0);

      const valid = verifySignature(manifestContent, signature, keys.publicKey);
      assert.equal(valid, true);
    });

    it("rejects tampered content", async () => {
      const keys = await generateKeyPair(tempDir);
      const manifestContent = '{"schema_version":"1.0","evidence":[]}';
      const signature = signManifest(manifestContent, keys.privateKey);

      const valid = verifySignature("tampered content", signature, keys.publicKey);
      assert.equal(valid, false);
    });
  });

  describe("runSign", () => {
    it("refreshes resume.md verification block from unsigned to signed", async () => {
      const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify({
        schema_version: "1.0",
        generated_at: "2026-01-01T00:00:00Z",
        repo: { url: "https://github.com/test/repo", head_commit: "abcdef1234567890" },
        author: { name: "Test", email: "test@test.com" },
        evidence: [],
        skills: [],
        claims: [],
        signatures: [],
      }, null, 2), "utf8");

      const resumePath = path.join(tempDir, "resume.md");
      await writeFile(
        resumePath,
        "# Test\n\n---\n\n## SkillProof Verification\n\n> ⚠️ Unsigned — run `skillproof sign` first to add cryptographic proof.\n",
        "utf8"
      );

      await runSign(tempDir);

      const resume = await readFile(resumePath, "utf8");
      assert.ok(!resume.includes("Unsigned"));
      assert.ok(resume.includes("Technical Verification Details"));
      assert.ok(resume.includes("Verification status:** SIGNED"));
    });
  });
});
