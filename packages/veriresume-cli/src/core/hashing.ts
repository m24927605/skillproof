import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf8");
  return hashContent(content);
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}
