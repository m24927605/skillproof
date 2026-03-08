# Hybrid LLM Cost Optimization — Implementation Plan

> **For Claude:** Implement this plan task-by-task. Prefer small, reviewable commits. After each task, run the specified tests before moving on.

**Goal:** Reduce Claude code review token cost sharply while preserving resume credibility by shifting most scoring to deterministic signals and reserving LLM review for high-risk, high-value, or low-confidence skills.

**Architecture:** Add a deterministic quality analysis layer, compute a per-skill review priority, gate LLM review to only selected skills, and replace raw-file review input with compact evidence digests. The final confidence becomes a merge of static and optional LLM confidence, with provenance recorded in the manifest.

**Tech Stack:** TypeScript, Node.js test runner, existing Anthropic SDK, existing scan/infer/render pipeline

## Success Criteria

- Re-running `infer-skills` on unchanged repos still benefits from existing cache.
- Total LLM-reviewed skills drops materially on medium/large repos.
- Resume output remains grounded in code evidence and does not overclaim skills that were not LLM-reviewed.
- Manifest clearly records which skills were reviewed by LLM and which were scored statically.
- New logic is covered by unit tests and does not regress current CLI behavior.

---

### Task 1: Extend Manifest Schema for Hybrid Scoring

**Files:**
- Modify: `packages/skillproof/src/types/manifest.ts`
- Modify: `packages/skillproof/src/commands/infer.test.ts`

**Goal:** Distinguish deterministic scoring from LLM-reviewed scoring.

**Required schema change:**

Add the following optional fields to `Skill`:

```typescript
export interface Skill {
  name: string;
  confidence: number;
  evidence_ids: string[];
  inferred_by: SkillInferenceMethod;
  strengths?: string[];
  reasoning?: string;
  static_confidence?: number;
  llm_confidence?: number;
  review_priority?: number;
  review_decision?: "static-only" | "llm-reviewed" | "cached-llm";
  evidence_digest?: string[];
}
```

**Step 1: Add failing test**

In `packages/skillproof/src/commands/infer.test.ts`, add a test that writes and reads a manifest containing `static_confidence`, `llm_confidence`, `review_priority`, `review_decision`, and `evidence_digest`.

**Step 2: Implement schema change**

Update `packages/skillproof/src/types/manifest.ts` with the new optional fields.

**Step 3: Verify**

Run:

```bash
cd packages/skillproof && node --experimental-strip-types --test src/commands/infer.test.ts
```

**Acceptance notes:**

- Keep existing fields backward compatible.
- Do not remove existing `confidence`, `strengths`, or `reasoning`.

---

### Task 2: Add Deterministic Quality Feature Extraction

**Files:**
- Create: `packages/skillproof/src/core/static-quality.ts`
- Create: `packages/skillproof/src/core/static-quality.test.ts`

**Goal:** Score code quality without LLM for most skills.

**Design requirements:**

Implement a deterministic feature extractor that analyzes the selected evidence files for a skill and returns:

```typescript
export interface StaticQualityResult {
  score: number;
  reasons: string[];
  signals: {
    file_count: number;
    owned_file_count: number;
    test_file_count: number;
    config_file_count: number;
    has_ci: boolean;
    has_lint: boolean;
    has_types: boolean;
    has_error_handling: boolean;
    has_validation: boolean;
  };
}
```

**Scoring guidance:**

- Start from a conservative base.
- Increase confidence when evidence includes tests, CI, lint/type configuration, validation, or clear error handling.
- Cap purely dependency/config-driven skills lower than code-backed skills.
- Keep scores bounded to `0.0..1.0`.

**Heuristic examples:**

- `try/catch`, `Result`, `zod`, `yup`, `assert`, `test`, `spec`, `eslint`, `tsconfig`, GitHub Actions workflows.
- Presence-based scoring is sufficient for v1; do not attempt full AST analysis yet.

**Step 1: Write failing tests**

Cover at least:

- more score when tests are present
- more score when lint/type/CI signals are present
- conservative score when only dependency/config evidence exists
- score always clamped to `0..1`

**Step 2: Implement `analyzeStaticQuality()`**

Use string/pattern checks over file paths and truncated contents. Keep it deterministic and cheap.

**Step 3: Verify**

Run:

```bash
cd packages/skillproof && node --experimental-strip-types --test src/core/static-quality.test.ts
```

**Code review focus:**

- Heuristics should be explainable.
- No expensive parsing or network calls.
- No hidden coupling to repo-specific conventions.

---

### Task 3: Build Compact Evidence Digests for LLM Review

**Files:**
- Create: `packages/skillproof/src/core/evidence-digest.ts`
- Create: `packages/skillproof/src/core/evidence-digest.test.ts`

**Goal:** Replace raw-file-heavy prompts with compact, high-signal digests.

**Required output shape:**

```typescript
export interface EvidenceDigest {
  summaryLines: string[];
  snippetBlocks: Array<{
    path: string;
    note: string;
    content: string;
  }>;
}
```

**Digest construction rules:**

- Include a small number of representative files only.
- Prefer files with highest ownership and strongest static signals.
- Include short summary lines such as:
  - `Owned 4 TypeScript files`
  - `Has tests covering API handlers`
  - `Uses zod validation`
  - `GitHub Actions workflow present`
- Include only minimal code snippets, not entire truncated files.
- Keep the digest token footprint materially below the current raw-file path.

**Step 1: Write failing tests**

Cover at least:

- digest prefers high-ownership files
- digest includes static summary lines
- digest limits snippet size and count

**Step 2: Implement `buildEvidenceDigest()`**

Use existing evidence metadata plus local file content.

**Step 3: Verify**

Run:

```bash
cd packages/skillproof && node --experimental-strip-types --test src/core/evidence-digest.test.ts
```

**Code review focus:**

- The digest must preserve evidence quality, not become generic.
- Snippet extraction must be deterministic.
- Token savings should come from summarization, not omission of critical signals.

---

### Task 4: Add LLM Review Gating Policy

**Files:**
- Create: `packages/skillproof/src/core/review-gate.ts`
- Create: `packages/skillproof/src/core/review-gate.test.ts`

**Goal:** Only send high-value or uncertain skills to Claude.

**Required API:**

```typescript
export interface ReviewGateInput {
  skill: string;
  staticConfidence: number;
  evidenceCount: number;
  fileEvidenceCount: number;
  staticReasons: string[];
}

export interface ReviewGateResult {
  priority: number;
  shouldReview: boolean;
  reason: string;
}
```

**Policy requirements:**

- Review when static confidence is mid-range or uncertain.
- Review when file-backed evidence exists but deterministic signals conflict.
- Prefer review for high-value core skills:
  - `TypeScript`, `JavaScript`, `Python`, `Go`, `Rust`
  - `React`, `Next.js`, `Express`, `FastAPI`
  - `Docker`, `Kubernetes`, `Terraform`
  - `Code Review`, `Testing`, `Architecture`
- Skip LLM when confidence is already strong and evidence is abundant unless the skill is explicitly high-value.
- Skip LLM when evidence is too weak to justify review.

**Step 1: Write failing tests**

Cover at least:

- high-value skill with middling static confidence gets reviewed
- weak dependency-only skill gets skipped
- strong, overdetermined skill gets lower priority than uncertain high-value skill

**Step 2: Implement `decideSkillReview()`**

Return a normalized `priority` score and a human-readable reason.

**Step 3: Verify**

Run:

```bash
cd packages/skillproof && node --experimental-strip-types --test src/core/review-gate.test.ts
```

**Code review focus:**

- Policy should be stable and explainable.
- Avoid hidden magic numbers without a named constant.

---

### Task 5: Update Code Review Prompt to Accept Evidence Digests

**Files:**
- Modify: `packages/skillproof/src/core/code-review.ts`
- Modify: `packages/skillproof/src/core/code-review.test.ts`

**Goal:** Use compact digest input instead of large raw file dumps.

**Required changes:**

- Add a new prompt builder path for digest-based review.
- Preserve JSON-only response shape:

```typescript
{
  "skill": "<skill name>",
  "quality_score": <0.0 to 1.0>,
  "reasoning": "<brief explanation grounded in evidence>",
  "strengths": ["<strength 1>", "<strength 2>"]
}
```

- Instruct the model explicitly:
  - score only from supplied evidence
  - do not infer unrelated experience
  - be conservative when evidence is thin

**Step 1: Update tests**

Add tests that assert:

- prompt includes digest summary lines
- prompt includes compact snippets, not full file sections
- parser remains unchanged and valid

**Step 2: Implement**

Prefer a new function such as `reviewSkillFromDigest()` rather than overloading too much hidden behavior into the existing path.

**Step 3: Verify**

Run:

```bash
cd packages/skillproof && node --experimental-strip-types --test src/core/code-review.test.ts
```

**Code review focus:**

- Prompt should reduce token usage materially.
- Reasoning must stay evidence-grounded.

---

### Task 6: Rework `infer.ts` into Hybrid Review Flow

**Files:**
- Modify: `packages/skillproof/src/commands/infer.ts`
- Modify: `packages/skillproof/src/commands/infer.test.ts`

**Goal:** Make deterministic analysis the default and LLM review the exception.

**Implementation requirements:**

For each detected skill:

1. collect evidence
2. compute `static_confidence` using `analyzeStaticQuality()`
3. compute `review_priority` and `shouldReview` using `decideSkillReview()`
4. if skipped:
   - set `confidence = static_confidence`
   - set `review_decision = "static-only"`
   - set `inferred_by = "static"`
5. if reviewed:
   - build digest
   - use existing cache key logic, but include digest-driving file hashes
   - run LLM review or use cached result
   - set `llm_confidence`
   - merge final confidence conservatively
   - set `review_decision = "llm-reviewed"` or `"cached-llm"`

**Confidence merge rule for v1:**

Use a conservative weighted merge:

```typescript
final = Math.round((staticConfidence * 0.35 + llmConfidence * 0.65) * 100) / 100;
```

If LLM is skipped, `final = staticConfidence`.

**Budget behavior:**

- Keep existing `--max-review-tokens` budget.
- Apply budget after sorting by `review_priority` descending.
- Skills excluded by budget fall back to `static-only`.

**Step 1: Write failing tests**

Add coverage for:

- skipped skills keep static confidence and `review_decision = "static-only"`
- reviewed skills record both static and llm confidence
- budget overflow causes static fallback
- cache hit records `review_decision = "cached-llm"`

**Step 2: Implement**

Refactor current `runInfer()` to use the new modules.

**Step 3: Verify**

Run:

```bash
cd packages/skillproof && node --experimental-strip-types --test src/commands/infer.test.ts
```

Then run the full suite:

```bash
cd packages/skillproof && node --experimental-strip-types --test src/**/*.test.ts
```

**Code review focus:**

- Avoid duplicate file reads where possible.
- Preserve current cache behavior semantics.
- Static fallback paths must be explicit and auditable.

---

### Task 7: Improve Cost Preview to Reflect Review Gating

**Files:**
- Modify: `packages/skillproof/src/core/token-estimate.ts`
- Modify: `packages/skillproof/src/core/token-estimate.test.ts`
- Modify: `packages/skillproof/src/commands/infer.ts`

**Goal:** Show users the true post-gating cost, not worst-case cost.

**Required output additions:**

- total detected skills
- skills selected for LLM review
- skills skipped to static-only
- cache hits among selected skills
- estimated actual token and cost after gating

**Step 1: Add failing tests**

Verify the preview display includes the review/skip split.

**Step 2: Implement**

Adjust preview calculation to only count gated review candidates.

**Step 3: Verify**

Run:

```bash
cd packages/skillproof && node --experimental-strip-types --test src/core/token-estimate.test.ts
```

**Code review focus:**

- Preview must match execution behavior.
- Do not show misleading worst-case numbers as the main estimate.

---

### Task 8: Make Resume Rendering Respect Confidence Provenance

**Files:**
- Modify: `packages/skillproof/src/core/llm.ts`
- Modify: `packages/skillproof/src/core/llm.test.ts`
- Modify: `packages/skillproof/src/commands/render.ts`
- Modify: `packages/skillproof/src/commands/render.test.ts`

**Goal:** Prevent overclaiming in the generated resume.

**Rendering requirements:**

- When `review_decision` is `llm-reviewed` or `cached-llm`, the renderer may use `strengths` and `reasoning` more directly.
- When `review_decision` is `static-only`, language must stay more conservative and evidence-grounded.
- Do not fabricate detailed capability narratives for static-only skills.

**Prompt requirement for LLM render:**

Include an instruction such as:

```text
If a skill is static-only, describe it conservatively from the evidence and avoid strong proficiency claims.
If a skill was llm-reviewed, you may use the provided strengths and reasoning to describe demonstrated capability.
```

**Step 1: Add failing tests**

Cover at least:

- render prompt includes provenance instructions
- static-only skill is rendered conservatively
- llm-reviewed skill can include strengths

**Step 2: Implement**

Update both non-LLM and LLM render paths.

**Step 3: Verify**

Run:

```bash
cd packages/skillproof && node --experimental-strip-types --test src/core/llm.test.ts src/commands/render.test.ts
```

**Code review focus:**

- Resume wording should align with evidence provenance.
- No regression in existing locale-aware render behavior.

---

### Task 9: Update Skill Documentation

**Files:**
- Modify: `skills/resume/SKILL.md`
- Modify: `README.md`

**Goal:** Keep Claude Code instructions aligned with the implementation.

**Required documentation changes:**

- explain that static analysis is the default scoring path
- explain that Claude review is selectively applied
- document `static_confidence`, `llm_confidence`, `review_priority`, `review_decision`
- document that `--dry-run` and cost preview reflect gated review volume

**Step 1: Implement**

Update schema and pipeline descriptions.

**Step 2: Verify**

Manually inspect the docs for consistency with code.

**Code review focus:**

- Docs should describe actual behavior, not aspirational behavior.

---

### Task 10: Final Validation

**Verification commands:**

```bash
cd packages/skillproof && node --experimental-strip-types --test src/**/*.test.ts
cd packages/skillproof && node --experimental-strip-types src/index.ts infer-skills --help
```

**Manual validation checklist:**

- Run `skillproof infer-skills --dry-run` on a medium repo and confirm selected-review counts look reasonable.
- Run `skillproof infer-skills` twice and confirm second run benefits from cache.
- Inspect `.skillproof/resume-manifest.json` and verify mixed provenance fields are present.
- Render a resume and confirm static-only skills use more conservative wording.

## Reviewer Notes

When reviewing Claude Code's implementation, prioritize these findings:

1. Any path where a static-only skill is rendered with expert-style language.
2. Any place where LLM review still reads large raw files instead of digest input.
3. Any mismatch between cost preview and actual review execution.
4. Any schema/documentation drift between `manifest.ts`, `SKILL.md`, and README.
5. Any cache key bug that could reuse stale reviews across changed evidence.

## Non-Goals for This Plan

- Switching model providers
- Adding AST parsers or language servers
- Rewriting scan/sign/verify pipeline
- Building per-language bespoke scoring engines

## Recommended Commit Sequence

1. `feat: add hybrid scoring fields to manifest`
2. `feat: add deterministic static quality analysis`
3. `feat: build compact evidence digests for review`
4. `feat: add llm review gating policy`
5. `refactor: switch code review prompts to digest inputs`
6. `feat: implement hybrid infer flow`
7. `feat: update gated cost preview`
8. `feat: make rendering provenance-aware`
9. `docs: update hybrid scoring documentation`
