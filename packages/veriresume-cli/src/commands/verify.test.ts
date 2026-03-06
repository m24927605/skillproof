import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyBundle } from "./verify.ts";
import { createEmptyManifest, writeManifest } from "../core/manifest.ts";
import { generateKeyPair, signManifest } from "./sign.ts";
import { canonicalJson } from "../core/hashing.ts";
import { runPack } from "./pack.ts";
import type { Signature } from "../types/manifest.ts";

describe("verify", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "veriresume-verify-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("verifies a valid bundle", async () => {
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });

    const keysDir = path.join(tempDir, ".veriresume", "keys");
    const keys = await generateKeyPair(keysDir);

    // Sign the manifest WITHOUT signatures field populated
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

    const manifestPath = path.join(tempDir, ".veriresume", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);
    await writeFile(path.join(tempDir, "resume.md"), "# Test\n", "utf8");

    await runPack(tempDir);

    const bundlePath = path.join(tempDir, "bundle.zip");
    const result = await verifyBundle(bundlePath);
    assert.equal(result.valid, true);
    assert.equal(result.signatures.length, 1);
    assert.equal(result.signatures[0].valid, true);
  });
});
