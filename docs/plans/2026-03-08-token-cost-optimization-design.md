# Token Cost Optimization Design

## Problem

The VeriResume CLI's LLM pipeline has several token cost inefficiencies:
1. No caching — re-running on unchanged repos pays full cost again
2. No file deduplication — same file reviewed multiple times across skills
3. No global budget — skill count explosion = unbounded cost
4. `improvements` field generated but never used in resume output
5. No cost preview — users cannot see estimated cost before committing

## Design

### 1. Review Result Cache

**Location**: `.veriresume/cache/reviews/`
**Cache key**: `SHA256(skillName + sortedFileHashes + promptVersion + model)`
**Format**: JSON file named `{cacheKey}.json` containing the review result

- On cache hit: skip LLM call, load cached result
- Invalidation: automatic when any file content changes, prompt version bumps, or model changes
- Cache is gitignored

### 2. Skill Grouping for File Deduplication

**Strategy**: Group skills that share >= 50% of their files into a single LLM call.

- Compute pairwise file overlap ratio between skills
- Skills with >= 50% overlap are merged into a review group
- Prompt requests independent scores for each skill in the group
- Output schema changes from single object to: `{ reviews: [{ skill, quality_score, strengths, reasoning }, ...] }`
- Skills with < 50% overlap remain independent

**Example**: TypeScript + React share `.tsx` files -> grouped. Docker stays independent.

### 3. Global Token Budget with Priority + User Confirmation

**New CLI flag**: `--max-review-tokens` (default: 200000)

- Skills sorted by evidence count descending (highest value first)
- When cumulative tokens approach budget: pause and prompt user
- Prompt shows: skills reviewed, tokens used, cost so far, remaining skills, estimated remaining cost
- User declines: remaining skills marked `inferred_by: static` with conservative score based on evidence count
- `--yes` flag: skip confirmation, respect budget silently

### 4. Remove `improvements` Field

- Remove from code-review.ts prompt (system message)
- Remove from response schema and parsing
- Remove from infer.ts output handling
- Update SKILL.md documentation
- Saves ~15-20% output tokens per skill review

### 5. Pre-Review Cost Estimation

**When**: After scan completes, before infer begins
**Data sources**: Skill grouping results, file token estimates, cache hit detection

Display format:
```
Code Review Cost Estimate
─────────────────────────
Skills: 8 (grouped into 5 review calls)
Files: 47 (32 after dedup)
Estimated input tokens: ~156K
Estimated output tokens: ~1.6K
Estimated cost: ~$0.49

Cache hits: 3/5 groups (unchanged since last run)
Actual reviews needed: 2
Actual estimated cost: ~$0.18

Proceed? [Y/n]
```

**Interaction modes**:
- Interactive (default): show estimate, wait for confirmation
- `--yes`: skip confirmation, execute directly
- `--dry-run`: show estimate only, do not execute

## Estimated Impact

| Optimization | Token Savings | Notes |
|---|---|---|
| Cache | ~100% on re-runs | Zero LLM cost when files unchanged |
| Skill grouping | ~30-50% | Depends on file overlap between skills |
| Global budget | Bounded ceiling | Prevents cost explosion with many skills |
| Remove improvements | ~15-20% output tokens | ~50-100 fewer tokens per skill |
| Cost preview | N/A | User awareness and control |

## Files to Modify

- `packages/veriresume-cli/src/commands/infer.ts` — caching, grouping, budget, cost preview
- `packages/veriresume-cli/src/commands/all.ts` — pass new flags, integrate cost preview
- `packages/veriresume-cli/src/core/code-review.ts` — remove improvements, support grouped review
- `packages/veriresume-cli/src/core/token-estimate.ts` — cost preview calculation
- `packages/veriresume-cli/src/core/skills.ts` — skill grouping logic
- `packages/veriresume-cli/src/index.ts` — new CLI flags
- `skills/resume/SKILL.md` — update documentation
- `.gitignore` — add `.veriresume/cache/`
