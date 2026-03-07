# CLI LLM-Powered Locale-Aware Resume Rendering

## Summary

Add Claude API integration to the CLI `render` command so it can generate locale-aware resumes directly, matching the skill version's capabilities. When no locale is specified, behavior remains unchanged (English template fallback).

## Approach

**Option chosen: Direct Anthropic SDK integration (Option A)**

Add `@anthropic-ai/sdk` as a dependency. The `render` command gains an optional locale parameter that triggers the LLM path.

## Flow

```
veriresume render [locale] [--locale <locale>]
        │
        ▼
  Has locale? ──no──▶ Existing English template (unchanged)
        │yes
        ▼
  Resolve API key (env var → config.json → interactive prompt)
        │
        ▼
  Key found? ──no──▶ Ask for input → ask to save to config.json
        │yes
        ▼
  Ask for optional personal info (interactive stdin)
        │
        ▼
  Read manifest, assemble prompt, call Claude API
        │
        ▼
  Assemble VeriResume verification block (fixed format)
        │
        ▼
  Write resume.md, print preview
```

## API Key Management

Resolution order:
1. `ANTHROPIC_API_KEY` environment variable
2. `.veriresume/config.json` → `anthropic_api_key` field
3. Interactive prompt → optionally save to config.json

Config format:
```json
{
  "anthropic_api_key": "sk-ant-..."
}
```

Security:
- `.veriresume/` is already in `.gitignore`
- `config.json` created with file permission `0o600`

## LLM Generation

- SDK: `@anthropic-ai/sdk`
- Model: `claude-sonnet-4-6`
- System prompt instructs Claude to write a professional resume in the target locale
- Rules: target language conventions, English skill names, confidence-to-human-friendly mapping, no fabrication, no evidence IDs, Markdown output
- User message includes: author info, skills sorted by confidence, evidence stats, optional personal info

## Verification Block

Same fixed format as the skill version. Assembled programmatically by `core/verification.ts`:
- Human-friendly summary: evidence items, skills verified, repo, commit, generated date
- Collapsible `<details>` block: manifest hash, signature algorithm, signer, public key fingerprint, signed at, verification status
- If unsigned: warning message instead of details

## New Files

| File | Responsibility |
|------|---------------|
| `core/llm.ts` | Claude API call wrapper: manifest + locale + personal info → resume Markdown |
| `core/config.ts` | Read/write `.veriresume/config.json` (API key storage) |
| `core/prompt.ts` | Interactive stdin prompts (readline wrapper) |
| `core/verification.ts` | Assemble VeriResume verification block from manifest data |

## Modified Files

| File | Change |
|------|--------|
| `commands/render.ts` | Add locale parameter parsing, LLM path branch, personal info collection |
| `src/index.ts` | Add locale argument and `--locale` option to render command |
| `package.json` | Add `@anthropic-ai/sdk` dependency |

## Testing

| Module | Test Focus |
|--------|-----------|
| `core/config.ts` | Read/write config, env var priority, missing file handling |
| `core/verification.ts` | Signed and unsigned manifest output format |
| `core/llm.ts` | Mock SDK, verify prompt assembly and response handling |
| `commands/render.ts` | No-locale old path, with-locale LLM path branching |
| `core/prompt.ts` | No unit tests (thin readline wrapper) |
