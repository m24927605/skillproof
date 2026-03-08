import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Manifest } from "../types/manifest.js";

export interface ManifestInit {
  repoUrl: string | null;
  headCommit: string;
  authorName: string;
  authorEmail: string;
}

export function createEmptyManifest(init: ManifestInit): Manifest {
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    repo: {
      url: init.repoUrl,
      head_commit: init.headCommit,
    },
    author: {
      name: init.authorName,
      email: init.authorEmail,
    },
    evidence: [],
    skills: [],
    claims: [],
    signatures: [],
  };
}

export async function writeManifest(
  filePath: string,
  manifest: Manifest
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(manifest, null, 2), "utf8");
}

export async function readManifest(filePath: string): Promise<Manifest> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as Manifest;
}

export function getManifestPath(repoRoot: string): string {
  return path.join(repoRoot, ".skillproof", "resume-manifest.json");
}
