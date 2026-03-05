# Multi-Project Scanning

## Summary

Add a `scan-multi` command that supports scanning multiple local sub-projects or remote GitHub repos, with interactive checkbox selection, multi-email identity resolution, and evidence merging into a single unified manifest.

## Approach

**New `scan-multi` command (Option A)** — independent from existing `scan`, two modes via `--github` flag.

## Command Interface

```bash
# Local mode: scan sub-projects under current directory
veriresume scan-multi

# GitHub mode: scan remote repos
veriresume scan-multi --github
```

## Local Mode Flow

1. Scan cwd for subdirectories containing `.git`
2. Interactive checkbox: user selects which repos to scan
3. Collect and confirm developer emails (identity resolution)
4. Sequentially scan each selected repo (reuse existing scan logic)
5. Merge all evidence into one manifest
6. Write to `.veriresume/resume-manifest.json`

## GitHub Mode Flow

1. Interactive checkbox (multi-select source types):
   - My repositories (`gh repo list`)
   - Contributed repositories (`gh api /user/repos?type=all`, filter non-owned)
   - Organization repositories (`gh api /orgs/{org}/repos`, prompt for org name)
2. Collect repos from all selected sources, deduplicate
3. Interactive checkbox: user selects which repos to scan
4. Collect and confirm developer emails (identity resolution)
5. Full clone each selected repo to temp directory (with progress)
6. Sequentially scan each clone
7. Merge all evidence into one manifest
8. Clean up temp clones (including on Ctrl+C)
9. Write to `.veriresume/resume-manifest.json`

## Developer Identity (Multi-Email)

Auto-collect email candidates from:
1. `git config --global user.email`
2. `gh api /user/emails` (all verified GitHub emails)
3. `git log --format='%ae' | sort -u` from each selected repo

Present deduplicated list as interactive checkbox. User confirms which emails are theirs. All confirmed emails used for `git blame` ownership and `git log` author filtering.

Manifest author field extended (backward compatible):
```typescript
author: { name: string, email: string, emails?: string[] }
```

## Evidence Merging

- Evidence `id` prefixed with repo name: `veriresume:EV-COMMIT-abc123`
- Evidence `source` prefixed with repo name: `veriresume/src/index.ts`
- Skills merged by name: same skill → highest confidence, evidence_ids union
- Manifest gains optional `repos` array (backward compatible):

```typescript
// Existing single repo field preserved
repo: { url: string | null, head_commit: string }

// New multi-repo field
repos?: { url: string | null, head_commit: string, name: string }[]
```

## Interactive Checkbox

New dependency: `@inquirer/prompts` (tree-shakeable, import only `checkbox`).

Added to `core/prompt.ts`:
```typescript
export async function checkboxPrompt<T>(
  message: string,
  choices: { name: string; value: T; checked?: boolean }[]
): Promise<T[]>
```

## Progress & Error Handling

- Per-repo progress: `Scanning 3 of 5 repositories: api-server`
- Clone progress for GitHub mode
- Single repo failure → warn and skip, continue others
- Final summary: `Scan complete. 4/5 succeeded, 1 failed (repo-name: reason)`
- Temp clone cleanup in `finally` block + process signal handler for Ctrl+C

## Token Cost

Scanning is pure CLI (git commands + file reads). **Zero AI tokens consumed.** Tokens only used later during `infer-skills` (LLM skill inference) and `render` (LLM resume generation), proportional to number of skills (tens), not files (thousands).

## New Files

| File | Responsibility |
|------|---------------|
| `commands/scan-multi.ts` | Main command: local/GitHub mode, repo discovery, checkbox selection, sequential scan, merge |
| `core/identity.ts` | Email candidate collection from git config + GitHub API + git log, deduplication |
| `core/github.ts` | GitHub repo listing: my repos / contributed / org repos, deduplication |
| `core/merge.ts` | Evidence merging: id/source prefixing, skill merge by name with max confidence |

## Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Register `scan-multi` command with `--github` option |
| `core/prompt.ts` | Add `checkboxPrompt()` using `@inquirer/prompts` |
| `types/manifest.ts` | Add `emails?` to AuthorInfo, add `repos?` to Manifest |
| `package.json` | Add `@inquirer/prompts` dependency |

## Test Files

| File | Focus |
|------|-------|
| `core/identity.test.ts` | Email collection, deduplication, source labeling |
| `core/merge.test.ts` | Evidence id/source prefixing, skill merge logic |
| `core/github.test.ts` | Repo list parsing, deduplication across sources |
| `commands/scan-multi.test.ts` | Local repo discovery, merge flow |
