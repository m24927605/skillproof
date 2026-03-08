import crypto from "node:crypto";
import { readFile, writeFile, mkdir, stat, chmod } from "node:fs/promises";
import path from "node:path";
import { readManifest, writeManifest, getManifestPath } from "../core/manifest.ts";
import { canonicalJson } from "../core/hashing.ts";
import type { Signature } from "../types/manifest.ts";

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
  const keysDir = path.join(cwd, ".veriresume", "keys");
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

export async function runSign(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const manifest = await readManifest(manifestPath);

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
  console.log("Manifest signed successfully.");
}
