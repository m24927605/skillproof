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
  tamperedFiles: string[];
  signatures: { signer: string; valid: boolean; error?: string }[];
  manifestHash: string;
}

/**
 * List zip entries and reject if any path escapes the target directory.
 * This runs BEFORE extraction so no malicious writes can occur.
 */
async function assertSafeZipEntries(bundlePath: string): Promise<void> {
  const { stdout } = await execFileAsync("unzip", ["-l", bundlePath]);
  for (const line of stdout.split("\n")) {
    // unzip -l output format: "  Length  Date  Time  Name"
    // Entry names are the last whitespace-delimited field
    const match = line.match(/^\s*\d+\s+\d{2}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/);
    if (!match) continue;
    const entryName = match[1].trim();
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
  const extractDir = await mkdtemp(path.join(tmpdir(), "veriresume-verify-"));

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
    if (result.tamperedFiles.length > 0) {
      console.log(`\nWARNING: Tampered files detected: ${result.tamperedFiles.join(", ")}`);
    } else {
      console.log(`\nWARNING: Resume files have been tampered with!`);
    }
  }

  if (!result.valid) {
    process.exitCode = 1;
  }
}
