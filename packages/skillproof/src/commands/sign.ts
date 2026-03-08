import crypto from "node:crypto";
import { readFile, writeFile, mkdir, stat, chmod, access } from "node:fs/promises";
import path from "node:path";
import { readManifest, writeManifest, getManifestPath } from "../core/manifest.ts";
import { canonicalJson, hashContent } from "../core/hashing.ts";
import { buildVerificationBlock } from "../core/verification.ts";
import type { Signature } from "../types/manifest.ts";

const RESUME_FORMATS = ["resume.md", "resume.pdf", "resume.png", "resume.jpg", "resume.jpeg"];
const VERIFICATION_HEADERS = [
  "\n---\n\n## SkillProof Verification\n\n",
  "\n---\n\n## VeriResume Verification\n\n",
];

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export async function generateKeyPair(keysDir: string): Promise<KeyPair> {
  await mkdir(keysDir, { recursive: true });

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const pubPath = path.join(keysDir, "candidate.pub");
  const privPath = path.join(keysDir, "candidate.key");

  await writeFile(pubPath, publicKey, "utf8");
  await writeFile(privPath, privateKey, { mode: 0o600 } as any);

  return { publicKey, privateKey };
}

export function signManifest(content: string, privateKeyPem: string): string {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(content), privateKey);
  return signature.toString("base64");
}

export function verifySignature(
  content: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  const publicKey = crypto.createPublicKey(publicKeyPem);
  return crypto.verify(
    null,
    Buffer.from(content),
    publicKey,
    Buffer.from(signatureBase64, "base64")
  );
}

async function loadOrGenerateKeys(cwd: string): Promise<KeyPair> {
  const keysDir = path.join(cwd, ".skillproof", "keys");
  const pubPath = path.join(keysDir, "candidate.pub");
  const privPath = path.join(keysDir, "candidate.key");

  try {
    const publicKey = await readFile(pubPath, "utf8");
    const privateKey = await readFile(privPath, "utf8");

    // Enforce strict permissions on private key (fix overly permissive existing files)
    const privStat = await stat(privPath);
    const mode = privStat.mode & 0o777;
    if (mode !== 0o600) {
      await chmod(privPath, 0o600);
    }

    return { publicKey, privateKey };
  } catch {
    console.log("No existing keys found. Generating new Ed25519 key pair...");
    return generateKeyPair(keysDir);
  }
}

async function refreshMarkdownVerificationBlock(cwd: string, manifestPath: string): Promise<void> {
  const resumePath = path.join(cwd, "resume.md");
  try {
    const current = await readFile(resumePath, "utf8");
    const marker = VERIFICATION_HEADERS
      .map((h) => ({ h, i: current.indexOf(h) }))
      .filter((x) => x.i >= 0)
      .sort((a, b) => a.i - b.i)[0];
    if (!marker) return;

    const manifest = await readManifest(manifestPath);
    const block = buildVerificationBlock(manifest);
    const next = `${current.slice(0, marker.i)}${block}`;
    await writeFile(resumePath, next, "utf8");
  } catch {
    // resume.md missing or unreadable: skip
  }
}

export async function runSign(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const manifest = await readManifest(manifestPath);

  // Compute file_hashes for any resume files present (ensures split-step CLI flow is covered)
  const fileHashes: Record<string, string> = {};
  for (const filename of RESUME_FORMATS) {
    try {
      await access(path.join(cwd, filename));
      const content = await readFile(path.join(cwd, filename));
      fileHashes[filename] = hashContent(content);
    } catch { /* doesn't exist */ }
  }
  if (Object.keys(fileHashes).length > 0) {
    manifest.file_hashes = fileHashes;
  }

  manifest.signatures = [];
  const content = canonicalJson(manifest);

  const keys = await loadOrGenerateKeys(cwd);
  const sig = signManifest(content, keys.privateKey);

  const signature: Signature = {
    signer: "candidate",
    public_key: Buffer.from(keys.publicKey).toString("base64"),
    signature: sig,
    timestamp: new Date().toISOString(),
    algorithm: "Ed25519",
  };

  manifest.signatures = [signature];
  await writeManifest(manifestPath, manifest);
  await refreshMarkdownVerificationBlock(cwd, manifestPath);
  console.log("Manifest signed successfully.");
}
