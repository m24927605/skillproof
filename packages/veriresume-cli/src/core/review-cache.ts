import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ReviewResult } from "./code-review.ts";

const CACHE_DIR = ".veriresume/cache/reviews";
export const PROMPT_VERSION = "v1";

export function computeCacheKey(
  skill: string,
  fileHashes: string[],
  promptVersion: string,
): string {
  const sorted = [...fileHashes].sort();
  const input = JSON.stringify({ skill, fileHashes: sorted, promptVersion });
  return createHash("sha256").update(input).digest("hex");
}

export async function getCachedReview(
  cwd: string,
  cacheKey: string,
): Promise<ReviewResult | null> {
  const filePath = path.join(cwd, CACHE_DIR, `${cacheKey}.json`);
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    // Validate required fields
    if (typeof parsed.skill !== "string" || typeof parsed.quality_score !== "number") {
      return null;
    }
    return parsed as ReviewResult;
  } catch {
    return null;
  }
}

export async function saveCachedReview(
  cwd: string,
  cacheKey: string,
  review: ReviewResult,
): Promise<void> {
  const dir = path.join(cwd, CACHE_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${cacheKey}.json`);
  await writeFile(filePath, JSON.stringify(review, null, 2) + "\n");
}

export async function getCachedGroupReview(
  cwd: string,
  cacheKey: string,
): Promise<ReviewResult[] | null> {
  const filePath = path.join(cwd, CACHE_DIR, `${cacheKey}.json`);
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.reviews)) {
      return parsed.reviews.filter(
        (r: unknown) =>
          typeof (r as Record<string, unknown>).skill === "string" &&
          typeof (r as Record<string, unknown>).quality_score === "number",
      ) as ReviewResult[];
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveCachedGroupReview(
  cwd: string,
  cacheKey: string,
  reviews: ReviewResult[],
): Promise<void> {
  const dir = path.join(cwd, CACHE_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${cacheKey}.json`);
  await writeFile(filePath, JSON.stringify({ reviews }, null, 2) + "\n");
}
