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
  fileHashesMissing: boolean;
  tamperedFiles: string[];
  signatures: { signer: string; valid: boolean; error?: string }[];
  manifestHash: string;
}

/**
 * List zip entries and reject if any path escapes the target directory.
 * Uses `zipinfo -1` for machine-parseable output (one filename per line).
 * This runs BEFORE extraction so no malicious writes can occur.
 */
async function assertSafeZipEntries(bundlePath: string): Promise<void> {
  const { stdout } = await execFileAsync("zipinfo", ["-1", bundlePath]);
  for (const line of stdout.split("\n")) {
    const entryName = line.trim();
    if (!entryName) continue;

    // Reject absolute paths, parent traversal, and backslash tricks
    if (
      path.isAbsolute(entryName) ||
      entryName.startsWith("../") ||
      entryName.includes("/../") ||
      entryName.startsWith("..\\") ||
      entryName.includes("\\..\\")
    ) {
      throw new Error(`Zip Slip detected: unsafe entry "${entryName}"`);
    }

    // Resolve against a dummy root and verify it stays within
    const resolved = path.resolve("/safe-root", entryName);
    if (!resolved.startsWith("/safe-root/") && resolved !== "/safe-root") {
      throw new Error(`Zip Slip detected: entry "${entryName}" escapes extraction directory`);
    }
  }
}

export async function verifyBundle(bundlePath: string): Promise<VerifyResult> {
  const extractDir = await mkdtemp(path.join(tmpdir(), "skillproof-verify-"));

  try {
    // Zip Slip protection: validate all entries BEFORE extraction
    await assertSafeZipEntries(bundlePath);

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

    // Verify file hashes from signed manifest (not unsigned verification.json)
    let resumeTampered = false;
    const tamperedFiles: string[] = [];
    const fileHashes: Record<string, string> = manifest.file_hashes || {};

    // If manifest has no file_hashes, check if resume files exist in bundle —
    // if they do, the manifest was signed without file_hashes (integrity gap)
    let fileHashesMissing = false;
    if (Object.keys(fileHashes).length === 0) {
      const RESUME_NAMES = ["resume.md", "resume.pdf", "resume.png", "resume.jpg", "resume.jpeg"];
      for (const name of RESUME_NAMES) {
        try {
          await readFile(path.join(extractDir, name));
          // Resume file exists but no signed hash — cannot verify integrity
          tamperedFiles.push(name);
          resumeTampered = true;
          fileHashesMissing = true;
        } catch { /* not present, fine */ }
      }
    }

    for (const [filename, expectedHash] of Object.entries(fileHashes)) {
      const safeName = path.basename(filename);
      try {
        const content = await readFile(path.join(extractDir, safeName));
        const actualHash = hashContent(content);
        if (actualHash !== expectedHash) {
          tamperedFiles.push(filename);
          resumeTampered = true;
        }
      } catch {
        tamperedFiles.push(filename);
        resumeTampered = true;
      }
    }

    return {
      valid: allSigsValid && !resumeTampered,
      resumeTampered,
      fileHashesMissing,
      tamperedFiles,
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
    if (result.fileHashesMissing) {
      console.log(`\nWARNING: Manifest missing file_hashes — resume file integrity cannot be verified.`);
      console.log(`  Re-sign after rendering: skillproof sign`);
    } else if (result.tamperedFiles.length > 0) {
      console.log(`\nWARNING: Tampered files detected: ${result.tamperedFiles.join(", ")}`);
    } else {
      console.log(`\nWARNING: Resume files have been tampered with!`);
    }
  }

  if (!result.valid) {
    process.exitCode = 1;
  }
}
