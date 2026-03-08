# Design: Skill Description from Code Review

**Date:** 2026-03-08
**Status:** Approved

## Goal

Make resume skill descriptions reflect real developer abilities by leveraging LLM code review results (strengths, reasoning) instead of generating generic descriptions from skill names alone.

## Current Problem

1. `code-review.ts` can do full code review → but is not connected to the pipeline
2. `infer.ts` scores skills using only evidence metadata (file paths, commit messages), not actual source code
3. `llm.ts` (render) receives only skill name + confidence + evidence count → LLM produces generic descriptions
4. SKILL.md `resume-infer` sets confidence from code review but does not capture strengths/improvements/reasoning

## Design

### 1. Extend Skill Type

Add optional fields to the Skill interface in `types/manifest.ts`:

```typescript
interface Skill {
  name: string;
  confidence: number;
  evidence_ids: string[];
  inferred_by: "static" | "llm";
  strengths?: string[];      // NEW
  improvements?: string[];   // NEW
  reasoning?: string;        // NEW
}
```

Update the Manifest Schema section in `skills/resume/SKILL.md` to match.

### 2. npm CLI Mode — Integrate Code Review into Infer

In `commands/infer.ts`:

- After detecting skills via `detectSkillEvidence()`, for each skill:
  1. Collect file evidence items with `type === "file"`
  2. Sort by `ownership` descending
  3. Read file contents up to a token budget (use `token-estimate.ts`)
  4. Call `reviewSkill()` from `code-review.ts`
  5. Use `quality_score` as confidence (replacing the current `scoreSkillsWithLLM` approach)
  6. Store `strengths`, `improvements`, `reasoning` on the Skill object

- File selection strategy: **Pure ownership sort** — no file type filtering, no "representative" heuristic. Token budget controls quantity naturally.

### 3. Claude Code Mode — Update SKILL.md resume-infer

Update step 3 of `resume-infer` to instruct Claude Code to also produce:
- `strengths`: array of specific strengths observed in the code
- `improvements`: array of areas for improvement
- `reasoning`: brief explanation of the assessment

These must be written into the manifest alongside confidence.

### 4. Render — Use Review Results

#### npm CLI LLM render (`core/llm.ts`)

Add `strengths` and `reasoning` to the prompt sent to the LLM. Do NOT include `improvements` — resume should only show positive capabilities. Improvements remain in the manifest for the developer's self-reference.

#### npm CLI non-LLM render (`commands/render.ts`)

In `renderResume()`, display strengths under each skill when available.

#### Claude Code render (SKILL.md `resume-render`)

Update instructions to tell Claude Code to use `strengths` and `reasoning` from the manifest when generating the resume. Do not include `improvements` in the resume output.

### 5. No Changes

- `scan` commands — unchanged
- `sign`, `pack`, `verify` — unchanged
- `code-review.ts` interface — already has the right shape (`ReviewResult`)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| File selection for review | By ownership, token-budget truncated | Most objective filter; no human bias on what's "representative" |
| Where to store review results | Extend Skill type (option A) | Simple, same lifecycle as skill detection, YAGNI |
| Improvements in resume | No — manifest only | Resumes show strengths; improvements for self-reference |
| Both modes produce same output | Yes | Same manifest schema, same fields, same render logic |
