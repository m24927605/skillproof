import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPair, signManifest, verifySignature } from "./sign.ts";

describe("sign", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "veriresume-test-"));
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
});
