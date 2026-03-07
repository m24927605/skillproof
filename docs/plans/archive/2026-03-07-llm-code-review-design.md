# LLM Code Review for Skill Confidence

## Summary

Replace static skill inference with LLM-powered code review. Before running, estimate token consumption and show cost for both Full and Sampled modes. User must choose one.

## Flow

```
1. Read manifest → group files by detected skill (file extension, dependency)
2. Filter files by ownership > 50%
3. Estimate tokens for Full and Sampled modes
4. Display cost comparison, user chooses A (Full) or B (Sampled)
5. Send code to Claude for quality review per skill
6. Write quality_score as confidence to manifest
```

## User Prompt

```
Code Review Token Estimate

Files eligible: 87 (ownership > 50%)
Skills detected: 12

  [A] Full review
      Input: ~120K tokens  Output: ~5K tokens
      Estimated cost: $0.40

  [B] Sampled review (3 files/skill)
      Input: ~30K tokens   Output: ~2K tokens
      Estimated cost: $0.10

Select review mode (A/B):
```

## Sampling Strategy

- Filter: only files with ownership > 50%
- Per skill: sort by file size descending, pick top 3
- Truncate each file to first 150 lines

## LLM Prompt Design

System: "You are a senior code reviewer. Review the code and assess the author's proficiency."

User: skill name + file contents

Response format (JSON):
```json
{
  "skill": "TypeScript",
  "quality_score": 0.85,
  "reasoning": "Good type safety, proper error handling...",
  "strengths": ["generics usage", "modular design"],
  "improvements": ["missing edge cases"]
}
```

## Token Estimation

- chars ÷ 4 for input tokens
- system prompt: ~300 tokens (fixed)
- output per skill: ~200 tokens (fixed estimate)

## Cost Calculation (Sonnet pricing)

- Input: $3 / 1M tokens
- Output: $15 / 1M tokens

## New Files

| File | Responsibility |
|------|---------------|
| `core/token-estimate.ts` | Token counting, cost estimation, display |
| `core/code-review.ts` | LLM code review prompt + API call |

## Modified Files

| File | Change |
|------|--------|
| `commands/infer.ts` | Replace static with: estimate → prompt → LLM review |
| `core/skills.ts` | Keep skill detection (file extension matching) but remove confidence scoring |
| `types/manifest.ts` | Add `review?` field to Skill for storing review details |
