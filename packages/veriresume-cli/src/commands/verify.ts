import { readFile, readdir, realpath, mkdtemp, rm } from "node:fs/promises";
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
 * Check all extracted files are within the extract directory (Zip Slip protection).
 */
async function assertNoPathTraversal(extractDir: string): Promise<void> {
  const realExtractDir = await realpath(extractDir);
  const entries = await readdir(extractDir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(entry.parentPath ?? entry.path, entry.name);
    const resolvedPath = await realpath(fullPath);
    if (!resolvedPath.startsWith(realExtractDir + path.sep) && resolvedPath !== realExtractDir) {
      throw new Error(`Zip Slip detected: ${entry.name} escapes extraction directory`);
    }
  }
}

export async function verifyBundle(bundlePath: string): Promise<VerifyResult> {
  const extractDir = await mkdtemp(path.join(tmpdir(), "veriresume-verify-"));

  try {
    await execFileAsync("unzip", ["-o", bundlePath, "-d", extractDir]);

    // Zip Slip protection: verify all files remain within extractDir
    await assertNoPathTraversal(extractDir);

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

    // Verify all file hashes from verification.json (not just resume.md)
    let resumeTampered = false;
    const tamperedFiles: string[] = [];
    try {
      const verificationContent = await readFile(
        path.join(extractDir, "verification.json"), "utf8"
      );
      const verification = JSON.parse(verificationContent);
      const fileHashes: Record<string, string> = verification.file_hashes || {};

      for (const [filename, expectedHash] of Object.entries(fileHashes)) {
        // Prevent path traversal in filenames from verification.json
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
    } catch {
      resumeTampered = true;
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
