# Token Cost Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce LLM token costs by adding caching, skill grouping, global budget control, cost preview, and removing unused `improvements` field.

**Architecture:** Four independent optimizations layered onto the existing infer pipeline. Cache sits between skill detection and LLM calls. Skill grouping merges overlapping skills before review. Global budget wraps the review loop with priority ordering and user confirmation. Cost preview runs before any LLM calls.

**Tech Stack:** Node.js, node:crypto (SHA256), node:fs/promises, existing prompt utilities

---

### Task 1: Remove `improvements` field from code review

**Files:**
- Modify: `packages/veriresume-cli/src/core/code-review.ts:4-10` (ReviewResult interface)
- Modify: `packages/veriresume-cli/src/core/code-review.ts:16-39` (buildReviewPrompt)
- Modify: `packages/veriresume-cli/src/core/code-review.ts:50-71` (parseReviewResponse)
- Modify: `packages/veriresume-cli/src/types/manifest.ts:15-23` (Skill interface)
- Modify: `packages/veriresume-cli/src/commands/infer.ts:144-152` (skill push with improvements)
- Modify: `packages/veriresume-cli/src/core/code-review.test.ts`
- Modify: `packages/veriresume-cli/src/commands/infer.test.ts:74-97`

**Step 1: Update test expectations to remove improvements**

In `code-review.test.ts`, remove `improvements` from all test JSON and assertions:

```typescript
// In parseReviewResponse tests, update JSON fixtures:
const json = JSON.stringify({
  skill: "TypeScript",
  quality_score: 0.85,
  reasoning: "Good code",
  strengths: ["type safety"],
});
```

In `infer.test.ts`, update the Skill type test:

```typescript
it("Skill type accepts strengths and reasoning fields", async () => {
  // ...
  manifest.skills = [
    {
      name: "TypeScript",
      confidence: 0.85,
      evidence_ids: ["EV-1"],
      inferred_by: "llm",
      strengths: ["Good type safety"],
      reasoning: "Solid TypeScript usage",
    },
  ];
  await writeManifest(manifestPath, manifest);
  const saved = await readManifest(manifestPath);
  assert.deepEqual(saved.skills[0].strengths, ["Good type safety"]);
  assert.equal(saved.skills[0].reasoning, "Solid TypeScript usage");
  assert.equal(saved.skills[0].improvements, undefined);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/core/code-review.test.ts' 'src/commands/infer.test.ts'`
Expected: Tests still pass (removing expected fields from test input won't fail yet, but the production code still references improvements)

**Step 3: Remove improvements from ReviewResult and prompt**

In `code-review.ts`:

```typescript
export interface ReviewResult {
  skill: string;
  quality_score: number;
  reasoning: string;
  strengths: string[];
}
```

In `buildReviewPrompt`, update the JSON schema in the system message — remove `"improvements"` line:

```typescript
Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "skill": "<skill name>",
  "quality_score": <0.0 to 1.0>,
  "reasoning": "<brief explanation>",
  "strengths": ["<strength 1>", "<strength 2>"]
}
```

In `parseReviewResponse`, remove the improvements line:

```typescript
return {
  skill: parsed.skill || "unknown",
  quality_score: Math.max(0, Math.min(1, Number(parsed.quality_score) || 0)),
  reasoning: parsed.reasoning || "",
  strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
};
```

**Step 4: Remove improvements from Skill interface**

In `manifest.ts`:

```typescript
export interface Skill {
  name: string;
  confidence: number;
  evidence_ids: string[];
  inferred_by: SkillInferenceMethod;
  strengths?: string[];
  reasoning?: string;
}
```

**Step 5: Remove improvements reference in infer.ts**

In `infer.ts:144-152`, remove `improvements: review.improvements`:

```typescript
skills.push({
  name,
  confidence: review.quality_score,
  evidence_ids: evs.map((e) => e.id),
  inferred_by: "llm" as const,
  strengths: review.strengths,
  reasoning: review.reasoning,
});
```

**Step 6: Run tests to verify they pass**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/**/*.test.ts'`
Expected: All PASS

**Step 7: Commit**

```bash
git add packages/veriresume-cli/src/core/code-review.ts packages/veriresume-cli/src/core/code-review.test.ts packages/veriresume-cli/src/types/manifest.ts packages/veriresume-cli/src/commands/infer.ts packages/veriresume-cli/src/commands/infer.test.ts
git commit -m "refactor: remove unused improvements field from code review schema"
```

---

### Task 2: Add review result caching

**Files:**
- Create: `packages/veriresume-cli/src/core/review-cache.ts`
- Create: `packages/veriresume-cli/src/core/review-cache.test.ts`
- Modify: `packages/veriresume-cli/src/commands/infer.ts`

**Step 1: Write failing tests for review cache**

Create `review-cache.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeCacheKey, getCachedReview, saveCachedReview } from "./review-cache.ts";

describe("review-cache", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "veriresume-cache-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("computeCacheKey", () => {
    it("returns consistent hash for same inputs", () => {
      const key1 = computeCacheKey("TypeScript", ["hash1", "hash2"], "v1");
      const key2 = computeCacheKey("TypeScript", ["hash1", "hash2"], "v1");
      assert.equal(key1, key2);
    });

    it("returns different hash for different skills", () => {
      const key1 = computeCacheKey("TypeScript", ["hash1"], "v1");
      const key2 = computeCacheKey("React", ["hash1"], "v1");
      assert.notEqual(key1, key2);
    });

    it("returns different hash for different file hashes", () => {
      const key1 = computeCacheKey("TypeScript", ["hash1"], "v1");
      const key2 = computeCacheKey("TypeScript", ["hash2"], "v1");
      assert.notEqual(key1, key2);
    });

    it("sorts file hashes for consistent key regardless of order", () => {
      const key1 = computeCacheKey("TypeScript", ["hash2", "hash1"], "v1");
      const key2 = computeCacheKey("TypeScript", ["hash1", "hash2"], "v1");
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
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/core/review-cache.test.ts'`
Expected: FAIL — module not found

**Step 3: Implement review-cache.ts**

Create `review-cache.ts`:

```typescript
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
    return JSON.parse(content) as ReviewResult;
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
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/core/review-cache.test.ts'`
Expected: All PASS

**Step 5: Integrate cache into infer.ts**

In `infer.ts`, add imports:

```typescript
import { computeCacheKey, getCachedReview, saveCachedReview, PROMPT_VERSION } from "../core/review-cache.ts";
```

In the review loop (after building `filesToReview`, before calling `reviewSkill`), add cache lookup:

```typescript
// Check cache
const fileHashes = fileEvidence
  .filter((ev) => filesToReview.some((f) => f.path === ev.source))
  .map((ev) => ev.hash);
const cacheKey = computeCacheKey(name, fileHashes, PROMPT_VERSION);
const cached = await getCachedReview(cwd, cacheKey);

if (cached) {
  console.log(`  ${name}: cached — ${cached.quality_score} — ${cached.reasoning}`);
  skills.push({
    name,
    confidence: cached.quality_score,
    evidence_ids: evs.map((e) => e.id),
    inferred_by: "llm" as const,
    strengths: cached.strengths,
    reasoning: cached.reasoning,
  });
  continue;
}
```

After successful `reviewSkill` call, save to cache:

```typescript
const review = await reviewSkill(apiKey, name, filesToReview);
await saveCachedReview(cwd, cacheKey, review);
```

**Step 6: Run all tests**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/**/*.test.ts'`
Expected: All PASS

**Step 7: Commit**

```bash
git add packages/veriresume-cli/src/core/review-cache.ts packages/veriresume-cli/src/core/review-cache.test.ts packages/veriresume-cli/src/commands/infer.ts
git commit -m "feat: add review result caching to skip LLM calls for unchanged files"
```

---

### Task 3: Skill grouping for file deduplication

**Files:**
- Create: `packages/veriresume-cli/src/core/skill-grouping.ts`
- Create: `packages/veriresume-cli/src/core/skill-grouping.test.ts`
- Modify: `packages/veriresume-cli/src/core/code-review.ts` (support grouped review)
- Modify: `packages/veriresume-cli/src/core/code-review.test.ts`
- Modify: `packages/veriresume-cli/src/commands/infer.ts`

**Step 1: Write failing tests for skill grouping**

Create `skill-grouping.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupSkillsByFileOverlap } from "./skill-grouping.ts";

describe("skill-grouping", () => {
  it("groups skills with >= 50% file overlap", () => {
    const skillFiles = new Map<string, string[]>();
    skillFiles.set("TypeScript", ["a.tsx", "b.ts", "c.tsx"]);
    skillFiles.set("React", ["a.tsx", "c.tsx", "d.tsx"]);
    skillFiles.set("Docker", ["Dockerfile"]);

    const groups = groupSkillsByFileOverlap(skillFiles, 0.5);
    // TypeScript and React share 2/3 files each -> grouped
    // Docker shares nothing -> independent
    assert.equal(groups.length, 2);

    const tsReactGroup = groups.find((g) => g.skills.includes("TypeScript"));
    assert.ok(tsReactGroup);
    assert.ok(tsReactGroup.skills.includes("React"));

    const dockerGroup = groups.find((g) => g.skills.includes("Docker"));
    assert.ok(dockerGroup);
    assert.equal(dockerGroup.skills.length, 1);
  });

  it("keeps all skills independent when no overlap", () => {
    const skillFiles = new Map<string, string[]>();
    skillFiles.set("Python", ["app.py"]);
    skillFiles.set("Go", ["main.go"]);

    const groups = groupSkillsByFileOverlap(skillFiles, 0.5);
    assert.equal(groups.length, 2);
  });

  it("deduplicates files in merged groups", () => {
    const skillFiles = new Map<string, string[]>();
    skillFiles.set("TypeScript", ["a.tsx", "b.tsx"]);
    skillFiles.set("React", ["a.tsx", "b.tsx"]);

    const groups = groupSkillsByFileOverlap(skillFiles, 0.5);
    assert.equal(groups.length, 1);
    // Files should be deduplicated
    assert.equal(groups[0].files.length, 2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/core/skill-grouping.test.ts'`
Expected: FAIL — module not found

**Step 3: Implement skill-grouping.ts**

```typescript
export interface SkillGroup {
  skills: string[];
  files: string[];
}

export function groupSkillsByFileOverlap(
  skillFiles: Map<string, string[]>,
  threshold: number = 0.5,
): SkillGroup[] {
  const skills = [...skillFiles.keys()];
  const assigned = new Set<string>();
  const groups: SkillGroup[] = [];

  for (let i = 0; i < skills.length; i++) {
    if (assigned.has(skills[i])) continue;

    const group: string[] = [skills[i]];
    assigned.add(skills[i]);
    const filesA = new Set(skillFiles.get(skills[i])!);

    for (let j = i + 1; j < skills.length; j++) {
      if (assigned.has(skills[j])) continue;

      const filesB = new Set(skillFiles.get(skills[j])!);
      const intersection = [...filesA].filter((f) => filesB.has(f)).length;
      const overlapA = intersection / filesA.size;
      const overlapB = intersection / filesB.size;

      if (overlapA >= threshold || overlapB >= threshold) {
        group.push(skills[j]);
        assigned.add(skills[j]);
        // Expand filesA with filesB for transitive grouping
        for (const f of filesB) filesA.add(f);
      }
    }

    const mergedFiles = [...new Set(group.flatMap((s) => skillFiles.get(s)!))];
    groups.push({ skills: group, files: mergedFiles });
  }

  return groups;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/core/skill-grouping.test.ts'`
Expected: All PASS

**Step 5: Add grouped review support to code-review.ts**

Add new function `buildGroupedReviewPrompt` and `reviewSkillGroup`:

```typescript
export function buildGroupedReviewPrompt(
  skills: string[],
  files: FileForReview[],
): { systemMessage: string; userMessage: string } {
  const skillList = skills.join(", ");
  const systemMessage = `You are a senior code reviewer. Review the provided code files and assess the author's proficiency in each of these skills: ${skillList}.

Evaluate based on:
- Code quality and readability
- Error handling and edge cases
- Design patterns and architecture
- Best practices and conventions
- Type safety and correctness

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "reviews": [
    {
      "skill": "<skill name>",
      "quality_score": <0.0 to 1.0>,
      "reasoning": "<brief explanation>",
      "strengths": ["<strength 1>", "<strength 2>"]
    }
  ]
}

Provide one review object per skill: ${skillList}.

Score guide:
- 0.9-1.0: Expert — exceptional patterns, comprehensive error handling, production-grade
- 0.7-0.89: Proficient — solid code, good practices, minor improvements possible
- 0.5-0.69: Intermediate — functional but lacks polish, some anti-patterns
- 0.3-0.49: Beginner — works but significant quality issues
- 0.0-0.29: Novice — major issues, poor practices`;

  const fileContents = files
    .map((f) => `### ${f.path} (ownership: ${Math.round(f.ownership * 100)}%)\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  const userMessage = `## Skills: ${skillList}\n\n## Code Files\n\n${fileContents}\n\nPlease review and rate the author's proficiency in each skill listed above.`;

  return { systemMessage, userMessage };
}

export function parseGroupedReviewResponse(response: string): ReviewResult[] {
  let jsonStr = response.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const reviews = Array.isArray(parsed.reviews) ? parsed.reviews : [parsed];
    return reviews.map((r: Record<string, unknown>) => ({
      skill: String(r.skill || "unknown"),
      quality_score: Math.max(0, Math.min(1, Number(r.quality_score) || 0)),
      reasoning: String(r.reasoning || ""),
      strengths: Array.isArray(r.strengths) ? r.strengths as string[] : [],
    }));
  } catch {
    throw new Error(`Failed to parse grouped review response: ${response.slice(0, 200)}`);
  }
}

export async function reviewSkillGroup(
  apiKey: string,
  skills: string[],
  files: FileForReview[],
): Promise<ReviewResult[]> {
  if (skills.length === 1) {
    const result = await reviewSkill(apiKey, skills[0], files);
    return [result];
  }

  const client = new Anthropic({ apiKey });
  const { systemMessage, userMessage } = buildGroupedReviewPrompt(skills, files);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024 * skills.length,
    system: systemMessage,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`No text response for skill group: ${skills.join(", ")}`);
  }

  return parseGroupedReviewResponse(textBlock.text);
}
```

**Step 6: Add tests for grouped review**

In `code-review.test.ts`, add:

```typescript
describe("buildGroupedReviewPrompt", () => {
  it("builds prompt for multiple skills", () => {
    const files = [
      { path: "src/App.tsx", content: "export default () => <div/>", ownership: 0.9, skill: "TypeScript" },
    ];
    const { systemMessage, userMessage } = buildGroupedReviewPrompt(["TypeScript", "React"], files);
    assert.ok(systemMessage.includes("TypeScript, React"));
    assert.ok(userMessage.includes("Skills: TypeScript, React"));
    assert.ok(systemMessage.includes('"reviews"'));
  });
});

describe("parseGroupedReviewResponse", () => {
  it("parses multi-skill response", () => {
    const json = JSON.stringify({
      reviews: [
        { skill: "TypeScript", quality_score: 0.85, reasoning: "Good", strengths: ["types"] },
        { skill: "React", quality_score: 0.75, reasoning: "OK", strengths: ["components"] },
      ],
    });
    const results = parseGroupedReviewResponse(json);
    assert.equal(results.length, 2);
    assert.equal(results[0].skill, "TypeScript");
    assert.equal(results[1].skill, "React");
  });
});
```

**Step 7: Integrate skill grouping into infer.ts**

Refactor `runInfer` to:
1. Collect files per skill first (build a `Map<string, string[]>` of skill -> file paths)
2. Call `groupSkillsByFileOverlap()` to get groups
3. For each group, collect unique files, check cache per group, call `reviewSkillGroup`
4. Map results back to individual skills

The cache key for groups should incorporate all skills in the group:

```typescript
// For grouped skills, use combined key
const groupSkillName = group.skills.sort().join("+");
const cacheKey = computeCacheKey(groupSkillName, fileHashes, PROMPT_VERSION);
```

**Step 8: Run all tests**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/**/*.test.ts'`
Expected: All PASS

**Step 9: Commit**

```bash
git add packages/veriresume-cli/src/core/skill-grouping.ts packages/veriresume-cli/src/core/skill-grouping.test.ts packages/veriresume-cli/src/core/code-review.ts packages/veriresume-cli/src/core/code-review.test.ts packages/veriresume-cli/src/commands/infer.ts
git commit -m "feat: group overlapping skills to deduplicate files and reduce token usage"
```

---

### Task 4: Global token budget with priority ordering and user confirmation

**Files:**
- Modify: `packages/veriresume-cli/src/commands/infer.ts` (add budget tracking)
- Modify: `packages/veriresume-cli/src/commands/all.ts` (pass new options)
- Modify: `packages/veriresume-cli/src/index.ts` (add CLI flag)

**Step 1: Add `--max-review-tokens` flag to CLI**

In `index.ts`, add to the `all` command and `infer-skills` command:

```typescript
.option("--max-review-tokens <tokens>", "Maximum total input tokens for code review (default: 200000)")
```

Parse as number and pass through to `runInfer` and `runAll`.

**Step 2: Add budget logic to infer.ts**

Update `runInfer` signature:

```typescript
export async function runInfer(
  cwd: string,
  options?: { skipLlm?: boolean; maxReviewTokens?: number; yes?: boolean },
): Promise<void>
```

Before the review loop, sort skill groups by total evidence count descending:

```typescript
const sortedGroups = [...groups].sort((a, b) => {
  const countA = a.skills.reduce((sum, s) => sum + (skillEvidence.get(s)?.length || 0), 0);
  const countB = b.skills.reduce((sum, s) => sum + (skillEvidence.get(s)?.length || 0), 0);
  return countB - countA;
});
```

Track cumulative tokens and check budget:

```typescript
const maxTokens = options?.maxReviewTokens ?? 200_000;
let cumulativeTokens = 0;

for (const group of sortedGroups) {
  // ... collect files, estimate tokens ...

  if (cumulativeTokens + groupTokens > maxTokens && cumulativeTokens > 0) {
    if (!options?.yes) {
      console.log(`\n  Budget alert: ${cumulativeTokens} / ${maxTokens} tokens used.`);
      console.log(`  Remaining ${remainingGroups} groups would add ~${groupTokens} tokens.`);
      const proceed = await askYesNo("  Continue reviewing?");
      if (!proceed) {
        // Mark remaining skills as static
        for (const skillName of group.skills) {
          skills.push({
            name: skillName,
            confidence: heuristicConfidence(skillEvidence.get(skillName)!),
            evidence_ids: skillEvidence.get(skillName)!.map((e) => e.id),
            inferred_by: "static" as const,
          });
        }
        continue;
      }
    }
  }

  cumulativeTokens += groupTokens;
  // ... proceed with review ...
}
```

**Step 3: Pass options through all.ts**

In `all.ts`, update `runAll` options type and pass to `runInfer`:

```typescript
await runInfer(cwd, {
  skipLlm: options?.skipLlm,
  maxReviewTokens: options?.maxReviewTokens,
  yes: options?.yes,
});
```

**Step 4: Run all tests**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/**/*.test.ts'`
Expected: All PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/commands/infer.ts packages/veriresume-cli/src/commands/all.ts packages/veriresume-cli/src/index.ts
git commit -m "feat: add global token budget with priority ordering and user confirmation"
```

---

### Task 5: Pre-review cost estimation

**Files:**
- Modify: `packages/veriresume-cli/src/core/token-estimate.ts` (update display for grouped + cached)
- Modify: `packages/veriresume-cli/src/core/token-estimate.test.ts`
- Modify: `packages/veriresume-cli/src/commands/infer.ts` (show estimate before review)

**Step 1: Update cost estimation to support groups and cache hits**

Add new function to `token-estimate.ts`:

```typescript
export interface CostPreview {
  totalGroups: number;
  cachedGroups: number;
  totalInputTokens: number;
  actualInputTokens: number; // after cache hits
  totalOutputTokens: number;
  actualOutputTokens: number;
  totalCost: number;
  actualCost: number;
  groupDetails: { skills: string[]; tokens: number; cached: boolean }[];
}

export function buildCostPreviewDisplay(preview: CostPreview): string {
  const formatTokens = (n: number) => n >= 1000 ? `~${Math.round(n / 1000)}K` : `${n}`;

  let display = `\nCode Review Cost Estimate\n`;
  display += `${"─".repeat(40)}\n`;
  display += `  Review groups: ${preview.totalGroups}\n`;
  display += `  Estimated input tokens: ${formatTokens(preview.totalInputTokens)}\n`;
  display += `  Estimated output tokens: ${formatTokens(preview.totalOutputTokens)}\n`;
  display += `  Estimated total cost: $${preview.totalCost.toFixed(2)}\n`;

  if (preview.cachedGroups > 0) {
    display += `\n  Cache hits: ${preview.cachedGroups}/${preview.totalGroups} groups\n`;
    display += `  Actual input tokens: ${formatTokens(preview.actualInputTokens)}\n`;
    display += `  Actual estimated cost: $${preview.actualCost.toFixed(2)}\n`;
  }

  display += `${"─".repeat(40)}\n`;
  return display;
}
```

**Step 2: Add tests for CostPreview display**

In `token-estimate.test.ts`, add:

```typescript
describe("buildCostPreviewDisplay", () => {
  it("shows cache savings when cache hits exist", () => {
    const preview = {
      totalGroups: 5,
      cachedGroups: 3,
      totalInputTokens: 150000,
      actualInputTokens: 60000,
      totalOutputTokens: 1000,
      actualOutputTokens: 400,
      totalCost: 0.465,
      actualCost: 0.186,
      groupDetails: [],
    };
    const display = buildCostPreviewDisplay(preview);
    assert.ok(display.includes("Cache hits: 3/5"));
    assert.ok(display.includes("$0.47")); // total
    assert.ok(display.includes("$0.19")); // actual
  });
});
```

**Step 3: Integrate cost preview into infer.ts**

After building groups and checking cache but before any LLM calls:

```typescript
// Build cost preview
const preview: CostPreview = { /* compute from groups + cache status */ };
console.log(buildCostPreviewDisplay(preview));

if (!options?.yes) {
  const proceed = await askYesNo("Proceed with code review?");
  if (!proceed) {
    console.log("Skipping LLM review. Using heuristic scores.");
    // Fall back to all static
    return;
  }
}
```

Add `--dry-run` support: if set, show preview and return without executing.

**Step 4: Add --dry-run and --yes flags**

In `index.ts`, add to relevant commands:

```typescript
.option("--dry-run", "Show cost estimate without executing review")
.option("--yes", "Skip all confirmation prompts")
```

**Step 5: Run all tests**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/**/*.test.ts'`
Expected: All PASS

**Step 6: Commit**

```bash
git add packages/veriresume-cli/src/core/token-estimate.ts packages/veriresume-cli/src/core/token-estimate.test.ts packages/veriresume-cli/src/commands/infer.ts packages/veriresume-cli/src/index.ts
git commit -m "feat: add pre-review cost estimation with cache awareness and dry-run mode"
```

---

### Task 6: Update .gitignore and SKILL.md documentation

**Files:**
- Modify: `.gitignore` (or create `.veriresume/.gitignore`)
- Modify: `skills/resume/SKILL.md`

**Step 1: Add cache directory to gitignore**

Add to the project's `.gitignore`:

```
.veriresume/cache/
```

**Step 2: Update SKILL.md**

Remove references to `improvements` field. Update documentation to reflect:
- Skill grouping behavior
- Cache behavior
- `--max-review-tokens` flag
- `--dry-run` flag
- Cost preview display

**Step 3: Commit**

```bash
git add .gitignore skills/resume/SKILL.md
git commit -m "docs: update gitignore and SKILL.md for token cost optimizations"
```

---

### Task 7: Final integration test

**Step 1: Run full test suite**

Run: `cd packages/veriresume-cli && node --test --experimental-strip-types --test-reporter spec 'src/**/*.test.ts'`
Expected: All PASS

**Step 2: Manual smoke test (optional)**

Run: `cd packages/veriresume-cli && node --experimental-strip-types src/index.ts infer-skills --dry-run`
Verify: Cost preview is displayed, no LLM calls made.

**Step 3: Final commit if any adjustments needed**
