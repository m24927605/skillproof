# Doctor Command & Prerequisites — Design Document

## Goal

Add a `skillproof doctor` command that checks all prerequisites and displays a flutter-doctor-style table. Update README with a Prerequisites section.

## Doctor Command

**File:** `packages/skillproof/src/commands/doctor.ts`

7 checks in order:

| # | Check | Method | Pass condition | Fail fix |
|---|-------|--------|----------------|----------|
| 1 | Node.js | `process.version` | >= 22 | `nvm install 22` |
| 2 | git | `git --version` | exists | `brew install git` / `apt install git` |
| 3 | git user.name | `git config user.name` | non-empty | `git config --global user.name "Your Name"` |
| 4 | git user.email | `git config user.email` | non-empty | `git config --global user.email "you@example.com"` |
| 5 | gh CLI | `gh --version` | exists | `brew install gh && gh auth login` |
| 6 | gh auth | `gh auth status` | authenticated | `gh auth login` |
| 7 | unzip | `unzip -v` | exists | `brew install unzip` / `apt install unzip` |

- gh CLI (#5, #6) are optional — show warning triangle instead of X on failure
- Exit code 0 if all required checks pass, 1 if any required check fails
- Register as `skillproof doctor` in `index.ts`

Output style (flutter doctor):
```
SkillProof Doctor
=================
✓ Node.js          v22.5.0 (>= 22 required)
✓ git              v2.43.0
✓ git user.name    m24927605
✓ git user.email   m24927605@gmail.com
△ gh CLI           not found (optional)
  → brew install gh && gh auth login
✓ unzip            available
```

## README Update

Add Prerequisites section with table of 7 items and a note to run `skillproof doctor`.

## Files Changed

- `src/commands/doctor.ts` — New file, doctor command implementation
- `src/commands/doctor.test.ts` — Tests
- `src/index.ts` — Register doctor command
- `README.md` — Add Prerequisites section
