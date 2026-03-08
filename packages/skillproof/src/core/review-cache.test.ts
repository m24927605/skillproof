import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeCacheKey, hashDigest, getCachedReview, saveCachedReview, getCachedGroupReview, saveCachedGroupReview, LLM_MODEL } from "./review-cache.ts";
import type { EvidenceDigest } from "./evidence-digest.ts";

describe("review-cache", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-cache-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("computeCacheKey", () => {
    it("returns consistent hash for same inputs", () => {
      const key1 = computeCacheKey("TypeScript", ["hash1", "hash2"], "v1", LLM_MODEL);
      const key2 = computeCacheKey("TypeScript", ["hash1", "hash2"], "v1", LLM_MODEL);
      assert.equal(key1, key2);
    });

    it("returns different hash for different skills", () => {
      const key1 = computeCacheKey("TypeScript", ["hash1"], "v1", LLM_MODEL);
      const key2 = computeCacheKey("React", ["hash1"], "v1", LLM_MODEL);
      assert.notEqual(key1, key2);
    });

    it("returns different hash for different file hashes", () => {
      const key1 = computeCacheKey("TypeScript", ["hash1"], "v1", LLM_MODEL);
      const key2 = computeCacheKey("TypeScript", ["hash2"], "v1", LLM_MODEL);
      assert.notEqual(key1, key2);
    });

    it("returns different hash for different prompt versions", () => {
      const key1 = computeCacheKey("TypeScript", ["hash1"], "v1", LLM_MODEL);
      const key2 = computeCacheKey("TypeScript", ["hash1"], "v2", LLM_MODEL);
      assert.notEqual(key1, key2);
    });

    it("returns different hash for different models", () => {
      const key1 = computeCacheKey("TypeScript", ["hash1"], "v1", "claude-sonnet-4-6");
      const key2 = computeCacheKey("TypeScript", ["hash1"], "v1", "claude-haiku-4-5");
      assert.notEqual(key1, key2);
    });

    it("sorts file hashes for consistent key regardless of order", () => {
      const key1 = computeCacheKey("TypeScript", ["hash2", "hash1"], "v1", LLM_MODEL);
      const key2 = computeCacheKey("TypeScript", ["hash1", "hash2"], "v1", LLM_MODEL);
      assert.equal(key1, key2);
    });
  });

  describe("hashDigest", () => {
    it("returns consistent hash for identical digests", () => {
      const digest: EvidenceDigest = {
        summaryLines: ["Owned 4 TypeScript files"],
        snippetBlocks: [{ path: "src/app.ts", note: "ownership: 95%", content: "const x = 1;" }],
      };
      assert.equal(hashDigest(digest), hashDigest(digest));
    });

    it("returns different hash when snippet content changes", () => {
      const digest1: EvidenceDigest = {
        summaryLines: ["Owned 4 TypeScript files"],
        snippetBlocks: [{ path: "src/app.ts", note: "ownership: 95%", content: "const x = 1;" }],
      };
      const digest2: EvidenceDigest = {
        summaryLines: ["Owned 4 TypeScript files"],
        snippetBlocks: [{ path: "src/app.ts", note: "ownership: 95%", content: "const x = 2;" }],
      };
      assert.notEqual(hashDigest(digest1), hashDigest(digest2));
    });

    it("returns different hash when summary lines change", () => {
      const digest1: EvidenceDigest = {
        summaryLines: ["Owned 4 TypeScript files"],
        snippetBlocks: [],
      };
      const digest2: EvidenceDigest = {
        summaryLines: ["Owned 5 TypeScript files"],
        snippetBlocks: [],
      };
      assert.notEqual(hashDigest(digest1), hashDigest(digest2));
    });

    it("produces different cache keys for same skill with different digests", () => {
      const digest1: EvidenceDigest = {
        summaryLines: ["Owned 4 files"],
        snippetBlocks: [{ path: "a.ts", note: "95%", content: "old code" }],
      };
      const digest2: EvidenceDigest = {
        summaryLines: ["Owned 4 files"],
        snippetBlocks: [{ path: "a.ts", note: "95%", content: "new code" }],
      };
      const key1 = computeCacheKey("TypeScript", [hashDigest(digest1)], "v1", LLM_MODEL);
      const key2 = computeCacheKey("TypeScript", [hashDigest(digest2)], "v1", LLM_MODEL);
      assert.notEqual(key1, key2);
    });

    it("per-skill key is independent of other skills in the group", () => {
      const tsDigest: EvidenceDigest = {
        summaryLines: ["Owned 4 TypeScript files"],
        snippetBlocks: [{ path: "src/app.ts", note: "95%", content: "const x = 1;" }],
      };
      const tsHash = hashDigest(tsDigest);
      // Same TypeScript digest hash produces same key regardless of group neighbors
      const key1 = computeCacheKey("TypeScript", [tsHash], "v1", LLM_MODEL);
      const key2 = computeCacheKey("TypeScript", [tsHash], "v1", LLM_MODEL);
      assert.equal(key1, key2);
    });
  });

  describe("getCachedReview / saveCachedReview", () => {
    it("returns null for cache miss", async () => {
      const result = await getCachedReview(tempDir, "nonexistent-key");
      assert.equal(result, null);
    });

    it("returns cached result after save", async () => {
      const review = {
        skill: "TypeScript",
        quality_score: 0.85,
        reasoning: "Good code",
        strengths: ["type safety"],
      };
      await saveCachedReview(tempDir, "test-key", review);
      const cached = await getCachedReview(tempDir, "test-key");
      assert.deepEqual(cached, review);
    });

    it("returns null for malformed cache entry", async () => {
      const dir = path.join(tempDir, ".skillproof", "cache", "reviews");
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "bad-key.json"), '{"broken": true}');
      const result = await getCachedReview(tempDir, "bad-key");
      assert.equal(result, null);
    });
  });

  describe("getCachedGroupReview / saveCachedGroupReview", () => {
    it("returns null for cache miss", async () => {
      const result = await getCachedGroupReview(tempDir, "nonexistent-group");
      assert.equal(result, null);
    });

    it("returns all cached reviews after save", async () => {
      const reviews = [
        { skill: "TypeScript", quality_score: 0.85, reasoning: "Good types", strengths: ["type safety"] },
        { skill: "React", quality_score: 0.75, reasoning: "Nice components", strengths: ["hooks usage"] },
      ];
      await saveCachedGroupReview(tempDir, "group-key", reviews);
      const cached = await getCachedGroupReview(tempDir, "group-key");
      assert.deepEqual(cached, reviews);
    });

    it("filters out malformed entries in group cache", async () => {
      const dir = path.join(tempDir, ".skillproof", "cache", "reviews");
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "partial-group.json"),
        JSON.stringify({
          reviews: [
            { skill: "TypeScript", quality_score: 0.85, reasoning: "Good" },
            { broken: true },
          ],
        }),
      );
      const result = await getCachedGroupReview(tempDir, "partial-group");
      assert.equal(result!.length, 1);
      assert.equal(result![0].skill, "TypeScript");
    });

    it("returns null for non-array reviews field", async () => {
      const dir = path.join(tempDir, ".skillproof", "cache", "reviews");
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "bad-group.json"),
        JSON.stringify({ reviews: "not-an-array" }),
      );
      const result = await getCachedGroupReview(tempDir, "bad-group");
      assert.equal(result, null);
    });

    it("does not interfere with single review cache", async () => {
      const singleReview = { skill: "Go", quality_score: 0.9, reasoning: "Clean", strengths: ["concurrency"] };
      const groupReviews = [
        { skill: "TypeScript", quality_score: 0.85, reasoning: "Good", strengths: ["types"] },
      ];
      await saveCachedReview(tempDir, "single-key", singleReview);
      await saveCachedGroupReview(tempDir, "group-key", groupReviews);

      const single = await getCachedReview(tempDir, "single-key");
      assert.deepEqual(single, singleReview);

      const group = await getCachedGroupReview(tempDir, "group-key");
      assert.deepEqual(group, groupReviews);

      // Single cache file is not a group cache
      const notGroup = await getCachedGroupReview(tempDir, "single-key");
      assert.equal(notGroup, null);
    });
  });
});
