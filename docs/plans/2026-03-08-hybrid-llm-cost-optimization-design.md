# Hybrid LLM Cost Optimization — Design Document

**Date:** 2026-03-08
**Status:** Approved
**Implementation plan:** `docs/plans/2026-03-08-hybrid-llm-cost-optimization-implementation.md`

## Problem

Running Claude code review on every detected skill is expensive. Most skills can be scored with deterministic signals. LLM review should be reserved for high-value or uncertain skills.

## Goal

Reduce LLM token cost sharply while preserving resume credibility by shifting most scoring to deterministic static analysis and reserving LLM review for selected skills only.

## Design Decisions

### 1. Confidence Fields

| Field | Presence | Meaning |
|-------|----------|---------|
| `static_confidence` | Always present on every skill | Deterministic quality score from `analyzeStaticQuality()` |
| `llm_confidence` | Only when LLM review was performed | Score returned by Claude code review |
| `confidence` | Always present (outward-facing) | Final score: `static_confidence` if static-only, or weighted merge if LLM-reviewed |

Merge formula (v1): `confidence = static_confidence * 0.35 + llm_confidence * 0.65`

### 2. Field Semantics: `inferred_by` vs `review_decision`

These two fields have distinct, non-overlapping responsibilities:

- **`inferred_by`**: Indicates **whether LLM participated in final scoring**. Only two values: `"static"` or `"llm"`. Set to `"llm"` when LLM review was performed (whether fresh or cached), meaning the final `confidence` is a weighted blend of both `static_confidence` and `llm_confidence`. Set to `"static"` when the skill was scored purely by deterministic analysis, meaning `confidence` equals `static_confidence`. Note: `inferred_by: "llm"` does **not** mean confidence came solely from the LLM — it means the LLM contributed to the blended score.

- **`review_decision`**: The **review lifecycle outcome**. Three values:
  - `"static-only"` — skill was not sent to LLM review
  - `"llm-reviewed"` — skill was sent to LLM and reviewed fresh
  - `"cached-llm"` — skill was sent to LLM review path but answered from cache

- **Detection source**: How the skill was initially found (dependency scan, file pattern, commit analysis, etc.) remains the responsibility of `detectSkillEvidence()`. Neither `inferred_by` nor `review_decision` encodes detection source.

### 3. Digest and Grouping Interaction

The existing skill grouping and batching pipeline is retained for efficiency. Changes:

- **Grouped prompts** contain per-skill digest sections. Each skill within a group gets its own evidence summary and snippets so the model can score skills independently.
- **Shared context** (e.g., repo-level signals like CI presence, language distribution) may appear once at the top of the grouped prompt.
- **Batching** operates on **digest payload size**, not raw file dumps. The 25K input token limit applies to the digest-based prompt.
- Individual skills still receive distinct `static_confidence`, `review_priority`, and `evidence_digest` values regardless of grouping.

### 4. Cache Strategy: Two-Level Caching

Caching operates at two levels: **per-skill** and **group-level**.

#### Per-Skill Cache (primary)

Each skill's LLM review result is cached independently, keyed by:

- Skill name
- File content hashes for that skill's evidence
- **Per-skill digest payload hash** — the exact digest section sent to the LLM for this skill
- **Digest version identifier** — a constant bumped whenever digest construction rules change
- **Prompt version identifier** — a constant bumped whenever the review prompt template changes
- Model identifier (existing)

This is the primary cache layer. When a neighboring skill in a group changes but this skill's digest is unchanged, the per-skill cache still hits. This avoids invalidating an entire group when one member changes.

#### Group-Level Cache (optimization)

A group-level cache entry may be stored for the full grouped prompt, keyed by:

- Sorted set of skill names in the group
- All per-skill digest payload hashes
- **Shared context hash** — hash of the repo-level shared context block (CI presence, language distribution, etc.)
- Digest version, prompt version, model identifier

A group-level hit populates all per-skill results at once. If the group-level cache misses (e.g., one skill changed), the system falls back to checking per-skill caches for unchanged members and only sends uncached skills to the LLM.

#### Invalidation Guarantees

- Changing digest construction rules → digest version bumps → all caches invalidate
- Changing prompt template → prompt version bumps → all caches invalidate
- Changing a file in one skill → that skill's digest hash changes → per-skill cache misses; other skills in the same group remain cached
- Changing group composition → group-level cache misses; per-skill caches for unchanged members still hit
- Changing shared context → shared context hash changes → group-level cache misses; per-skill caches still hit (shared context affects group scoring but per-skill cache captures the actual result)

### 5. Architecture Flow

```
detectSkillEvidence()           ← detection (unchanged)
  → analyzeStaticQuality()      → static_confidence (all skills)
  → decideSkillReview()         → shouldReview + priority
  → [if review] buildEvidenceDigest() per skill
  → [if review] group skills, build prompt with per-skill digest sections
  → [if review] batch by digest payload size
  → [if review] LLM review (or cache hit) → llm_confidence
  → merge final confidence
  → set inferred_by + review_decision
  → manifest with full provenance
  → provenance-aware resume rendering
```

### 6. Review Gating Policy

- Review when static confidence is mid-range or uncertain
- Review when file-backed evidence exists but deterministic signals conflict
- Prefer review for high-value core skills (languages, frameworks, infrastructure, practices)
- Skip when confidence is already strong and evidence abundant (unless high-value)
- Skip when evidence is too weak to justify review cost
- Budget-constrained: skills exceeding `--max-review-tokens` fall back to static-only

### 7. Resume Rendering Provenance

- `llm-reviewed` / `cached-llm` skills: renderer may use `strengths` and `reasoning` directly
- `static-only` skills: language stays conservative and evidence-grounded; no fabricated capability narratives

## Non-Goals

- Switching model providers
- Adding AST parsers or language servers
- Rewriting scan/sign/verify pipeline
- Building per-language bespoke scoring engines

## Implementation

See `docs/plans/2026-03-08-hybrid-llm-cost-optimization-implementation.md` for the 10-task implementation plan with TDD workflow, verification commands, and recommended commit sequence.
