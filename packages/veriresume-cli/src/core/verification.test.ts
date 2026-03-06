import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildVerificationBlock } from "./verification.ts";
import type { Manifest } from "../types/manifest.ts";

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schema_version: "1.0",
    generated_at: "2026-01-01T00:00:00Z",
    repo: { url: "https://github.com/test/repo", head_commit: "abcdef1234567890" },
    author: { name: "Test", email: "test@test.com" },
    evidence: [
      { id: "EV-1", type: "commit", hash: "a", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "abc" },
      { id: "EV-2", type: "file", hash: "b", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "test.ts" },
    ],
    skills: [
      { name: "TypeScript", confidence: 1, evidence_ids: ["EV-2"], inferred_by: "static" },
    ],
    claims: [],
    signatures: [],
    ...overrides,
  };
}

describe("verification", () => {
  it("builds block with signature data when signed", () => {
    const manifest = makeManifest({
      signatures: [{
        signer: "candidate",
        public_key: "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0K",
        signature: "abc123==",
        timestamp: "2026-01-01T12:00:00Z",
        algorithm: "Ed25519",
      }],
    });

    const block = buildVerificationBlock(manifest);

    assert.ok(block.includes("## VeriResume Verification"));
    assert.ok(block.includes("**Evidence items:** 2"));
    assert.ok(block.includes("**Skills verified:** 1"));
    assert.ok(block.includes("**Repository:** https://github.com/test/repo"));
    assert.ok(block.includes("**Commit:** abcdef1"));
    assert.ok(block.includes("**Signature algorithm:** Ed25519"));
    assert.ok(block.includes("**Signer:** candidate"));
    assert.ok(block.includes("**Public key fingerprint:** LS0tLS1CRUdJTiBQ"));
    assert.ok(block.includes("SIGNED"));
    assert.ok(block.includes("<details>"));
  });

  it("shows unsigned warning when no signatures", () => {
    const manifest = makeManifest({ signatures: [] });
    const block = buildVerificationBlock(manifest);

    assert.ok(block.includes("## VeriResume Verification"));
    assert.ok(block.includes("**Evidence items:** 2"));
    assert.ok(!block.includes("<details>"));
    assert.ok(block.includes("Unsigned"));
  });

  it("uses 'local' when repo url is null", () => {
    const manifest = makeManifest({ repo: { url: null, head_commit: "abc1234" } });
    const block = buildVerificationBlock(manifest);
    assert.ok(block.includes("**Repository:** local"));
  });
});
