import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canonicalJson, hashContent } from "../core/hashing.ts";
import { verifySignature } from "./sign.ts";
import type { Manifest, Signature } from "../types/manifest.ts";

const execFileAsync = promisify(execFile);

export interface VerifyResult {
  valid: boolean;
  resumeTampered: boolean;
  signatures: { signer: string; valid: boolean; error?: string }[];
  manifestHash: string;
}

export async function verifyBundle(bundlePath: string): Promise<VerifyResult> {
  const extractDir = await mkdtemp(path.join(tmpdir(), "veriresume-verify-"));

  try {
    await execFileAsync("unzip", ["-o", bundlePath, "-d", extractDir]);

    const manifestContent = await readFile(
      path.join(extractDir, "resume-manifest.json"),
      "utf8"
    );
    const manifest: Manifest = JSON.parse(manifestContent);

    const manifestForVerify = { ...manifest, signatures: [] as Signature[] };
    const canonicalContent = canonicalJson(manifestForVerify);
    const manifestHash = hashContent(canonicalContent);

    const sigResults = manifest.signatures.map((sig) => {
      try {
        const publicKeyPem = Buffer.from(sig.public_key, "base64").toString("utf8");
        const valid = verifySignature(canonicalContent, sig.signature, publicKeyPem);
        return { signer: sig.signer, valid };
      } catch (err) {
        return { signer: sig.signer, valid: false, error: String(err) };
      }
    });

    const allSigsValid = sigResults.length > 0 && sigResults.every((s) => s.valid);

    let resumeTampered = false;
    try {
      const verificationContent = await readFile(
        path.join(extractDir, "verification.json"), "utf8"
      );
      const verification = JSON.parse(verificationContent);
      if (verification.resume_hash) {
        const resumeContent = await readFile(
          path.join(extractDir, "resume.md"), "utf8"
        );
        const actualHash = hashContent(resumeContent);
        resumeTampered = actualHash !== verification.resume_hash;
      }
    } catch {
      resumeTampered = true;
    }

    return {
      valid: allSigsValid && !resumeTampered,
      resumeTampered,
      signatures: sigResults,
      manifestHash,
    };
  } finally {
    await rm(extractDir, { recursive: true });
  }
}

export async function runVerify(bundlePath: string): Promise<void> {
  const result = await verifyBundle(bundlePath);

  console.log(`\nVerification Report`);
  console.log(`${"=".repeat(40)}`);
  console.log(`Manifest hash: ${result.manifestHash}`);
  console.log(`Overall: ${result.valid ? "VALID" : "INVALID"}`);
  console.log(`\nSignatures:`);

  for (const sig of result.signatures) {
    const status = sig.valid ? "PASS" : "FAIL";
    console.log(`  ${sig.signer}: ${status}${sig.error ? ` (${sig.error})` : ""}`);
  }

  if (result.resumeTampered) {
    console.log(`\nWARNING: resume.md has been tampered with!`);
  }

  if (!result.valid) {
    process.exitCode = 1;
  }
}
