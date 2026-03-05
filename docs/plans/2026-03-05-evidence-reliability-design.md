# Evidence Reliability Fixes — Design Document

## Problems

1. **File evidence hashes file path, not content** — `scan.ts:42` passes `filePath` as content to `createFileEvidence`
2. **Ownership hardcoded to 1.0** — No `git blame` analysis
3. **No GitHub PR/review evidence** — Missing a major source of verifiable contributions

## Fixes

### 1. File Content Hashing

- Read actual file content in `runScan`, pass to `createFileEvidence`
- Change `buildEvidence` `files` param from `string[]` to `{ path, content, ownership }[]`
- Skip files >1MB to avoid memory issues

### 2. Git Blame Ownership

- New `getFileOwnership(cwd, filePath, authorEmail)` in `git.ts`
- Uses `git blame --porcelain` to count author lines / total lines
- Applied to file and config evidence; commits stay 1.0
- Parallel limit: max 10 concurrent blame calls

### 3. GitHub PR Evidence

- New `EvidenceType: "pull_request"`
- Uses `gh api` (no new dependencies) to fetch merged PRs
- Graceful degradation: skips if gh not authenticated
- Each merged PR → `EV-PR-{number}` evidence node
- New skill signals: "Code Review", "Collaboration" from PR data

## Files Changed

- `src/types/manifest.ts` — Add "pull_request" to EvidenceType
- `src/core/git.ts` — Add getFileOwnership, getAuthorPRs, getGitHubUsername, parseBlame
- `src/core/evidence.ts` — Add createPREvidence
- `src/commands/scan.ts` — Fix file content reading, add blame ownership, add PR scanning
- `src/core/skills.ts` — Add PR-based skill rules
- All affected test files updated
