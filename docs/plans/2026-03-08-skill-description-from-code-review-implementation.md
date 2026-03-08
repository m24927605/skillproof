# Skill Description from Code Review — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire code review results (strengths, improvements, reasoning) into the infer→render pipeline so resumes describe real developer abilities.

**Architecture:** Extend the Skill type with review fields. In infer, read source files sorted by ownership and call `reviewSkill()` per skill. In render, pass strengths+reasoning to the LLM prompt. Update SKILL.md to match.

**Tech Stack:** TypeScript, Node.js test runner, Anthropic SDK (existing)

---

### Task 1: Extend Skill Type

**Files:**
- Modify: `packages/veriresume-cli/src/types/manifest.ts:15-19`

**Step 1: Write the failing test**

Add to `packages/veriresume-cli/src/commands/infer.test.ts`:

```typescript
it("Skill type accepts strengths, improvements, reasoning fields", async () => {
  const manifest = createEmptyManifest({
    repoUrl: null,
    headCommit: "abc",
    authorName: "Test",
    authorEmail: "test@example.com",
  });
  manifest.skills = [
    {
      name: "TypeScript",
      confidence: 0.85,
      evidence_ids: ["EV-1"],
      inferred_by: "llm",
      strengths: ["Good type safety"],
      improvements: ["Missing error handling"],
      reasoning: "Solid TypeScript usage",
    },
  ];
  await writeManifest(manifestPath, manifest);
  const saved = await readManifest(manifestPath);
  assert.deepEqual(saved.skills[0].strengths, ["Good type safety"]);
  assert.deepEqual(saved.skills[0].improvements, ["Missing error handling"]);
  assert.equal(saved.skills[0].reasoning, "Solid TypeScript usage");
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/commands/infer.test.ts`
Expected: FAIL — TypeScript compile error, `strengths` does not exist on type `Skill`

**Step 3: Write minimal implementation**

In `packages/veriresume-cli/src/types/manifest.ts`, change the Skill interface:

```typescript
export interface Skill {
  name: string;
  confidence: number;
  evidence_ids: string[];
  inferred_by: SkillInferenceMethod;
  strengths?: string[];
  improvements?: string[];
  reasoning?: string;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/commands/infer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/types/manifest.ts packages/veriresume-cli/src/commands/infer.test.ts
git commit -m "feat: extend Skill type with strengths, improvements, reasoning"
```

---

### Task 2: Integrate Code Review into Infer (file reading + reviewSkill call)

**Files:**
- Modify: `packages/veriresume-cli/src/commands/infer.ts:56-105` (replace `scoreSkillsWithLLM` with per-skill code review)
- Read: `packages/veriresume-cli/src/core/code-review.ts` (existing `reviewSkill`)
- Read: `packages/veriresume-cli/src/core/token-estimate.ts` (existing `FileForReview`, `truncateFileContent`)

**Step 1: Write the failing test**

Add to `packages/veriresume-cli/src/commands/infer.test.ts`:

```typescript
import { readFile } from "node:fs/promises";

it("collectFilesForReview returns files sorted by ownership descending", async () => {
  // Import the function we'll create
  const { collectFilesForReview } = await import("./infer.ts");

  const evidence = [
    { id: "EV-FILE-a", type: "file" as const, hash: "a", timestamp: "2026-01-01T00:00:00Z", ownership: 0.3, source: "low.ts" },
    { id: "EV-FILE-b", type: "file" as const, hash: "b", timestamp: "2026-01-01T00:00:00Z", ownership: 0.9, source: "high.ts" },
    { id: "EV-FILE-c", type: "file" as const, hash: "c", timestamp: "2026-01-01T00:00:00Z", ownership: 0.7, source: "mid.ts" },
    { id: "EV-COMMIT-d", type: "commit" as const, hash: "d", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "abc" },
  ];
  const evidenceIds = evidence.map((e) => e.id);

  const files = collectFilesForReview(evidence, evidenceIds);
  assert.equal(files.length, 3); // only file type
  assert.equal(files[0].source, "high.ts"); // highest ownership first
  assert.equal(files[1].source, "mid.ts");
  assert.equal(files[2].source, "low.ts");
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/commands/infer.test.ts`
Expected: FAIL — `collectFilesForReview` is not exported

**Step 3: Write minimal implementation**

Add to `packages/veriresume-cli/src/commands/infer.ts`:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { reviewSkill } from "../core/code-review.ts";
import { truncateFileContent, estimateTokens } from "../core/token-estimate.ts";
import type { FileForReview } from "../core/token-estimate.ts";
import type { Evidence } from "../types/manifest.ts";

const TOKEN_BUDGET_PER_SKILL = 50_000;

export function collectFilesForReview(
  allEvidence: Evidence[],
  evidenceIds: string[],
): Evidence[] {
  return allEvidence
    .filter((e) => evidenceIds.includes(e.id) && e.type === "file")
    .sort((a, b) => b.ownership - a.ownership);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/commands/infer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/commands/infer.ts packages/veriresume-cli/src/commands/infer.test.ts
git commit -m "feat: add collectFilesForReview sorted by ownership"
```

---

### Task 3: Replace scoreSkillsWithLLM with per-skill code review in runInfer

**Files:**
- Modify: `packages/veriresume-cli/src/commands/infer.ts:122-196` (`runInfer` function)

**Step 1: Write the failing test**

Add to `packages/veriresume-cli/src/commands/infer.test.ts`:

```typescript
it("runInfer with skipLlm stores empty strengths/improvements/reasoning", async () => {
  const manifest = createEmptyManifest({
    repoUrl: null,
    headCommit: "abc",
    authorName: "Test",
    authorEmail: "test@example.com",
  });
  manifest.evidence = [
    {
      id: "EV-FILE-abc",
      type: "file",
      hash: "abc",
      timestamp: "2025-01-01T00:00:00Z",
      ownership: 1.0,
      source: "src/index.ts",
    },
  ];
  await writeManifest(manifestPath, manifest);

  const { runInfer } = await import("./infer.ts");
  await runInfer(tempDir, { skipLlm: true });

  const saved = await readManifest(manifestPath);
  const tsSkill = saved.skills.find((s) => s.name === "TypeScript");
  assert.ok(tsSkill, "TypeScript skill should be detected");
  // skipLlm mode: no review, so fields should be undefined or empty
  assert.equal(tsSkill.strengths, undefined);
  assert.equal(tsSkill.improvements, undefined);
  assert.equal(tsSkill.reasoning, undefined);
});
```

**Step 2: Run test to verify it passes (baseline — skipLlm path unchanged)**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/commands/infer.test.ts`
Expected: PASS (skipLlm path doesn't set these fields)

**Step 3: Rewrite the LLM path in runInfer**

Replace the `else` branch (lines ~143-173) in `runInfer` that calls `scoreSkillsWithLLM` with per-skill code review:

```typescript
// In the else branch (LLM enabled):
console.log(`\nAnalyzing ${skillEvidence.size} skills with code review...`);

skills = [];
for (const [name, evs] of skillEvidence) {
  const fileEvidence = collectFilesForReview(manifest.evidence, evs.map((e) => e.id));

  if (fileEvidence.length === 0) {
    // No files to review — use heuristic
    skills.push({
      name,
      confidence: heuristicConfidence(evs),
      evidence_ids: evs.map((e) => e.id),
      inferred_by: "static" as const,
    });
    continue;
  }

  // Read file contents, sorted by ownership, up to token budget
  const filesToReview: FileForReview[] = [];
  let tokenCount = 0;
  for (const ev of fileEvidence) {
    const filePath = path.join(cwd, ev.source);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue; // file may not exist (e.g., deleted)
    }
    const truncated = truncateFileContent(content);
    const tokens = estimateTokens(truncated);
    if (tokenCount + tokens > TOKEN_BUDGET_PER_SKILL && filesToReview.length > 0) {
      break;
    }
    filesToReview.push({ path: ev.source, content: truncated, ownership: ev.ownership, skill: name });
    tokenCount += tokens;
  }

  if (filesToReview.length === 0) {
    skills.push({
      name,
      confidence: heuristicConfidence(evs),
      evidence_ids: evs.map((e) => e.id),
      inferred_by: "static" as const,
    });
    continue;
  }

  console.log(`  Reviewing ${name}: ${filesToReview.length} files, ~${Math.round(tokenCount / 1000)}K tokens`);
  const review = await reviewSkill(apiKey, name, filesToReview);
  console.log(`  ${name}: ${review.quality_score} — ${review.reasoning}`);

  skills.push({
    name,
    confidence: review.quality_score,
    evidence_ids: evs.map((e) => e.id),
    inferred_by: "llm" as const,
    strengths: review.strengths,
    improvements: review.improvements,
    reasoning: review.reasoning,
  });
}
```

Also remove the now-unused `scoreSkillsWithLLM` function and `buildSkillSummary` function from `infer.ts`.

**Step 4: Run all infer tests**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/commands/infer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/commands/infer.ts
git commit -m "feat: replace scoreSkillsWithLLM with per-skill code review"
```

---

### Task 4: Update LLM Render Prompt to Include Strengths + Reasoning

**Files:**
- Modify: `packages/veriresume-cli/src/core/llm.ts:14-63`
- Test: `packages/veriresume-cli/src/core/llm.test.ts`

**Step 1: Write the failing test**

Add to `packages/veriresume-cli/src/core/llm.test.ts`:

```typescript
it("includes strengths and reasoning in user message when available", () => {
  const manifestWithReview: Manifest = {
    ...manifest,
    skills: [
      {
        name: "TypeScript",
        confidence: 0.85,
        evidence_ids: ["EV-2"],
        inferred_by: "llm",
        strengths: ["Strong type definitions", "Good error handling"],
        reasoning: "Demonstrates solid TypeScript proficiency with strict typing",
      },
    ],
  };
  const { userMessage } = buildPromptMessages(manifestWithReview, "en-US", null);
  assert.ok(userMessage.includes("Strong type definitions"));
  assert.ok(userMessage.includes("Good error handling"));
  assert.ok(userMessage.includes("Demonstrates solid TypeScript proficiency"));
});

it("does not include improvements in user message", () => {
  const manifestWithReview: Manifest = {
    ...manifest,
    skills: [
      {
        name: "TypeScript",
        confidence: 0.85,
        evidence_ids: ["EV-2"],
        inferred_by: "llm",
        strengths: ["Good code"],
        improvements: ["Needs more tests"],
        reasoning: "OK",
      },
    ],
  };
  const { userMessage } = buildPromptMessages(manifestWithReview, "en-US", null);
  assert.ok(!userMessage.includes("Needs more tests"));
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/core/llm.test.ts`
Expected: FAIL — strengths not included in user message

**Step 3: Write minimal implementation**

In `packages/veriresume-cli/src/core/llm.ts`, update `buildPromptMessages` — change the `skillLines` mapping:

```typescript
const skillLines = skills
  .map((s) => {
    let line = `- ${s.name} (confidence: ${s.confidence}, evidence count: ${s.evidence_ids.length}, inferred by: ${s.inferred_by})`;
    if (s.strengths && s.strengths.length > 0) {
      line += `\n  Strengths: ${s.strengths.join("; ")}`;
    }
    if (s.reasoning) {
      line += `\n  Assessment: ${s.reasoning}`;
    }
    return line;
  })
  .join("\n");
```

Also update the system message to instruct the LLM to use these details:

```typescript
const systemMessage = `You are a professional resume writer. Based on the verified skill data provided, write a professional resume in ${locale}.

Rules:
- Write in the target language, following that culture's resume conventions.
- Keep technical skill names in English (TypeScript, Node.js, etc.).
- Convert confidence scores to human-friendly descriptions in the target language:
  - 0.9–1.0: Expert level
  - 0.7–0.89: Proficient level
  - 0.5–0.69: Familiar level
  - Below 0.5: Beginner level
- Use the provided strengths and assessment to describe what the developer actually did with each technology. Be specific and grounded in the evidence.
- Do NOT fabricate skills or experiences not present in the data.
- Do NOT include evidence IDs.
- If personal info is provided, integrate it naturally.
- Output pure Markdown only. No code fences around the output.`;
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/core/llm.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/core/llm.ts packages/veriresume-cli/src/core/llm.test.ts
git commit -m "feat: include strengths and reasoning in LLM render prompt"
```

---

### Task 5: Update Non-LLM Render to Show Strengths

**Files:**
- Modify: `packages/veriresume-cli/src/commands/render.ts:23-54` (`renderResume`)
- Test: `packages/veriresume-cli/src/commands/render.test.ts`

**Step 1: Write the failing test**

Add to `packages/veriresume-cli/src/commands/render.test.ts`:

```typescript
it("displays strengths when available", () => {
  const manifest: Manifest = {
    schema_version: "1.0",
    generated_at: "2025-01-01T00:00:00Z",
    repo: { url: null, head_commit: "abc" },
    author: { name: "Jane", email: "jane@ex.com" },
    evidence: [],
    skills: [
      {
        name: "TypeScript",
        confidence: 0.85,
        evidence_ids: [],
        inferred_by: "llm",
        strengths: ["Strong type definitions", "Good error handling"],
        reasoning: "Solid TypeScript usage",
      },
    ],
    claims: [],
    signatures: [],
  };
  const md = renderResume(manifest);
  assert.ok(md.includes("Strong type definitions"));
  assert.ok(md.includes("Good error handling"));
});

it("does not display improvements in resume", () => {
  const manifest: Manifest = {
    schema_version: "1.0",
    generated_at: "2025-01-01T00:00:00Z",
    repo: { url: null, head_commit: "abc" },
    author: { name: "Jane", email: "jane@ex.com" },
    evidence: [],
    skills: [
      {
        name: "TypeScript",
        confidence: 0.85,
        evidence_ids: [],
        inferred_by: "llm",
        strengths: [],
        improvements: ["Needs more tests"],
        reasoning: "OK",
      },
    ],
    claims: [],
    signatures: [],
  };
  const md = renderResume(manifest);
  assert.ok(!md.includes("Needs more tests"));
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/commands/render.test.ts`
Expected: FAIL — strengths not in output

**Step 3: Write minimal implementation**

In `packages/veriresume-cli/src/commands/render.ts`, update `renderResume`:

```typescript
for (const skill of skills) {
  md += `### ${skill.name}\n`;
  md += `- **Confidence:** ${skill.confidence}\n`;
  md += `- **Evidence:** ${skill.evidence_ids.join(" ")}\n`;
  md += `- **Inferred by:** ${skill.inferred_by}\n`;
  if (skill.strengths && skill.strengths.length > 0) {
    md += `- **Strengths:**\n`;
    for (const s of skill.strengths) {
      md += `  - ${s}\n`;
    }
  }
  md += `\n`;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && node --experimental-strip-types --test src/commands/render.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/commands/render.ts packages/veriresume-cli/src/commands/render.test.ts
git commit -m "feat: display strengths in non-LLM resume render"
```

---

### Task 6: Update SKILL.md — Manifest Schema + resume-infer + resume-render

**Files:**
- Modify: `skills/resume/SKILL.md`

**Step 1: Update Manifest Schema section**

In the `skills` array schema, add the new fields:

```
"skills": [
  { "name": "string", "confidence": 0.0-1.0, "evidence_ids": ["string"], "inferred_by": "static|llm", "strengths": ["string"], "improvements": ["string"], "reasoning": "string" }
],
```

**Step 2: Update resume-infer step 3**

Replace the current step 3 with:

```
3. **Code review by Claude Code:**
   - For each detected skill, find evidence items with `type=file`.
   - Sort by `ownership` descending.
   - Read the files using the Read tool (up to ~50K tokens worth of content per skill).
   - Assess the author's proficiency:
     - 0.9–1.0: Expert (clean architecture, advanced patterns, thorough error handling)
     - 0.7–0.89: Proficient (solid code, good practices)
     - 0.5–0.69: Familiar (functional, room for improvement)
     - below 0.5: Beginner (basic usage)
   - Set each skill's `confidence` to the assessed score.
   - Set `inferred_by` to `"llm"` after review.
   - Set `strengths` to an array of specific strengths observed (e.g., "Strong type definitions with interfaces and generics", "Comprehensive error handling with custom error types").
   - Set `improvements` to an array of areas for improvement (e.g., "Some functions lack input validation").
   - Set `reasoning` to a brief explanation of the assessment (1-2 sentences).
```

**Step 3: Update resume-render step 4**

Add to the generation rules:

```
   - Use the `strengths` and `reasoning` fields from each skill to describe what the developer actually did with each technology. Be specific and grounded in the code review evidence.
   - Do NOT include `improvements` in the resume output. These are for the developer's private reference only.
```

**Step 4: Commit**

```bash
git add skills/resume/SKILL.md
git commit -m "docs: update SKILL.md with strengths/improvements/reasoning fields"
```

---

### Task 7: Update Template File

**Files:**
- Modify: `skills/resume/templates/resume.modern.md`

**Step 1: Update template**

```markdown
# {{authorName}}

> Verifiable Developer Resume — generated {{generatedAt}}

## Skills

{{#skills}}
### {{name}}
- **Confidence:** {{confidence}}
- **Evidence:** {{evidenceIds}}
- **Inferred by:** {{inferredBy}}
{{#strengths}}
- **Strengths:**
{{#items}}
  - {{.}}
{{/items}}
{{/strengths}}

{{/skills}}

## Evidence Summary

- **Total evidence items:** {{evidenceCount}}
- **Commits analyzed:** {{commitCount}}
- **Dependencies detected:** {{dependencyCount}}
- **Config files scanned:** {{configCount}}

---

*This resume was generated by [VeriResume](https://github.com/veriresume) and can be cryptographically verified.*
*Repo: {{repoUrl}} @ {{headCommit}}*
```

**Step 2: Commit**

```bash
git add skills/resume/templates/resume.modern.md
git commit -m "docs: add strengths to resume template"
```

---

### Task 8: Run Full Test Suite and Verify

**Step 1: Run all tests**

```bash
cd packages/veriresume-cli && node --experimental-strip-types --test src/**/*.test.ts
```

Expected: ALL PASS

**Step 2: Fix any failures**

If any tests fail, fix them before proceeding.

**Step 3: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: resolve test failures from code review integration"
```
