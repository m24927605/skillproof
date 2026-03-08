# Evidence Reliability Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three core evidence reliability issues: file content hashing, git blame ownership, and GitHub PR evidence.

**Architecture:** Extend existing git.ts with blame/GitHub functions, fix scan.ts to read actual file content with real ownership, add pull_request evidence type.

**Tech Stack:** Node.js child_process (git blame, gh api), existing crypto/hashing modules.

---

### Task 1: Add "pull_request" to EvidenceType

**Files:**
- Modify: `packages/skillproof/src/types/manifest.ts:1`

**Step 1: Update the type**

Change line 1 from:
```typescript
export type EvidenceType = "commit" | "file" | "snippet" | "dependency" | "config";
```
To:
```typescript
export type EvidenceType = "commit" | "file" | "snippet" | "dependency" | "config" | "pull_request";
```

**Step 2: Verify it compiles**

Run: `cd packages/skillproof && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/skillproof/src/types/manifest.ts
git commit -m "feat: add pull_request to EvidenceType"
```

---

### Task 2: Add git blame parsing to git.ts

**Files:**
- Modify: `packages/skillproof/src/core/git.ts`
- Modify: `packages/skillproof/src/core/git.test.ts`

**Step 1: Write failing tests**

Add these tests to `git.test.ts`:

```typescript
import { parseBlameOutput } from "./git.ts";

describe("parseBlameOutput", () => {
  it("calculates ownership from blame output", () => {
    const blame = [
      "abc1234 1 1 1",
      "author John",
      "author-mail <john@example.com>",
      "author-time 1700000000",
      "author-tz +0000",
      "committer John",
      "committer-mail <john@example.com>",
      "committer-time 1700000000",
      "committer-tz +0000",
      "summary feat: add login",
      "filename src/index.ts",
      "\tconst x = 1;",
      "def5678 2 2 1",
      "author Jane",
      "author-mail <jane@example.com>",
      "author-time 1700000001",
      "author-tz +0000",
      "committer Jane",
      "committer-mail <jane@example.com>",
      "committer-time 1700000001",
      "committer-tz +0000",
      "summary fix: typo",
      "filename src/index.ts",
      "\tconst y = 2;",
    ].join("\n");

    const ownership = parseBlameOutput(blame, "john@example.com");
    assert.equal(ownership, 0.5); // 1 of 2 lines
  });

  it("returns 0 when author has no lines", () => {
    const blame = [
      "abc1234 1 1 1",
      "author Jane",
      "author-mail <jane@example.com>",
      "author-time 1700000000",
      "author-tz +0000",
      "committer Jane",
      "committer-mail <jane@example.com>",
      "committer-time 1700000000",
      "committer-tz +0000",
      "summary init",
      "filename src/index.ts",
      "\tline 1",
    ].join("\n");

    const ownership = parseBlameOutput(blame, "john@example.com");
    assert.equal(ownership, 0);
  });

  it("returns 1 when author owns all lines", () => {
    const blame = [
      "abc1234 1 1 1",
      "author John",
      "author-mail <john@example.com>",
      "author-time 1700000000",
      "author-tz +0000",
      "committer John",
      "committer-mail <john@example.com>",
      "committer-time 1700000000",
      "committer-tz +0000",
      "summary init",
      "filename src/index.ts",
      "\tline 1",
    ].join("\n");

    const ownership = parseBlameOutput(blame, "john@example.com");
    assert.equal(ownership, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof && npm test 2>&1 | tail -20`
Expected: FAIL — parseBlameOutput not exported

**Step 3: Implement parseBlameOutput and getFileOwnership in git.ts**

Add to the end of `git.ts`:

```typescript
export function parseBlameOutput(raw: string, authorEmail: string): number {
  const lines = raw.split("\n");
  let totalLines = 0;
  let authorLines = 0;
  let currentEmail = "";

  for (const line of lines) {
    if (line.startsWith("author-mail ")) {
      currentEmail = line.replace("author-mail ", "").replace(/[<>]/g, "");
    } else if (line.startsWith("\t")) {
      totalLines++;
      if (currentEmail === authorEmail) {
        authorLines++;
      }
    }
  }

  if (totalLines === 0) return 0;
  return Math.round((authorLines / totalLines) * 100) / 100;
}

export async function getFileOwnership(
  cwd: string,
  filePath: string,
  authorEmail: string
): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["blame", "--porcelain", "--", filePath],
      { cwd, maxBuffer: 10 * 1024 * 1024 }
    );
    return parseBlameOutput(stdout, authorEmail);
  } catch {
    return 0;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof && npm test 2>&1 | tail -20`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof/src/core/git.ts packages/skillproof/src/core/git.test.ts
git commit -m "feat: add git blame parsing with ownership calculation"
```

---

### Task 3: Add GitHub PR functions to git.ts

**Files:**
- Modify: `packages/skillproof/src/core/git.ts`
- Modify: `packages/skillproof/src/core/git.test.ts`

**Step 1: Write failing tests**

Add to `git.test.ts`:

```typescript
import { parseGitHubPRs, parseRepoFromRemote } from "./git.ts";

describe("parseRepoFromRemote", () => {
  it("parses HTTPS remote URL", () => {
    const result = parseRepoFromRemote("https://github.com/owner/repo.git");
    assert.deepEqual(result, { owner: "owner", repo: "repo" });
  });

  it("parses SSH remote URL", () => {
    const result = parseRepoFromRemote("git@github.com:owner/repo.git");
    assert.deepEqual(result, { owner: "owner", repo: "repo" });
  });

  it("returns null for non-GitHub URL", () => {
    const result = parseRepoFromRemote("https://gitlab.com/owner/repo.git");
    assert.equal(result, null);
  });
});

describe("parseGitHubPRs", () => {
  it("parses gh api JSON output", () => {
    const json = JSON.stringify([
      {
        number: 42,
        title: "feat: add auth",
        state: "closed",
        merged_at: "2025-06-15T10:00:00Z",
        html_url: "https://github.com/owner/repo/pull/42",
        additions: 150,
        deletions: 20,
        user: { login: "john" },
      },
      {
        number: 43,
        title: "docs: update readme",
        state: "closed",
        merged_at: null,
        html_url: "https://github.com/owner/repo/pull/43",
        additions: 10,
        deletions: 5,
        user: { login: "john" },
      },
    ]);

    const prs = parseGitHubPRs(json);
    // Only merged PRs
    assert.equal(prs.length, 1);
    assert.equal(prs[0].number, 42);
    assert.equal(prs[0].title, "feat: add auth");
    assert.equal(prs[0].mergedAt, "2025-06-15T10:00:00Z");
    assert.equal(prs[0].additions, 150);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement in git.ts**

Add to the end of `git.ts`:

```typescript
export interface RepoId {
  owner: string;
  repo: string;
}

export function parseRepoFromRemote(remoteUrl: string): RepoId | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

export interface PullRequest {
  number: number;
  title: string;
  mergedAt: string;
  url: string;
  additions: number;
  deletions: number;
}

export function parseGitHubPRs(json: string): PullRequest[] {
  const raw = JSON.parse(json) as Array<{
    number: number;
    title: string;
    merged_at: string | null;
    html_url: string;
    additions: number;
    deletions: number;
  }>;

  return raw
    .filter((pr) => pr.merged_at !== null)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      mergedAt: pr.merged_at!,
      url: pr.html_url,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
    }));
}

export async function isGhAuthenticated(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

export async function getAuthorPRs(
  repoId: RepoId,
  authorLogin: string
): Promise<PullRequest[]> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api",
      `repos/${repoId.owner}/${repoId.repo}/pulls`,
      "--paginate",
      "-q", `.[] | select(.user.login == "${authorLogin}")`,
      "--jq", ".",
    ]);
    // gh api with --paginate returns newline-separated JSON arrays
    // Wrap in array if needed
    const normalized = stdout.trim();
    if (!normalized) return [];

    // Try parsing as array first, then as individual objects
    try {
      return parseGitHubPRs(`[${normalized.split("\n").join(",")}]`);
    } catch {
      return parseGitHubPRs(normalized);
    }
  } catch {
    return [];
  }
}

export async function getGitHubUsername(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api", "user", "--jq", ".login",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add packages/skillproof/src/core/git.ts packages/skillproof/src/core/git.test.ts
git commit -m "feat: add GitHub PR parsing and repo remote URL extraction"
```

---

### Task 4: Add createPREvidence to evidence.ts

**Files:**
- Modify: `packages/skillproof/src/core/evidence.ts`
- Modify: `packages/skillproof/src/core/evidence.test.ts`

**Step 1: Write failing test**

Add to `evidence.test.ts`:

```typescript
import { createPREvidence } from "./evidence.ts";

describe("createPREvidence", () => {
  it("creates evidence for a merged PR", () => {
    const ev = createPREvidence({
      number: 42,
      title: "feat: add auth",
      mergedAt: "2025-06-15T10:00:00Z",
      url: "https://github.com/owner/repo/pull/42",
      additions: 150,
      deletions: 20,
    });
    assert.equal(ev.id, "EV-PR-42");
    assert.equal(ev.type, "pull_request");
    assert.equal(ev.source, "https://github.com/owner/repo/pull/42");
    assert.equal(ev.ownership, 1.0);
    assert.ok(ev.hash.length === 64);
    assert.deepEqual(ev.metadata, {
      title: "feat: add auth",
      additions: 150,
      deletions: 20,
    });
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement in evidence.ts**

Add this import and function:

```typescript
import type { PullRequest } from "./git.ts";

export function createPREvidence(pr: PullRequest): Evidence {
  return {
    id: `EV-PR-${pr.number}`,
    type: "pull_request",
    hash: hashContent(`PR#${pr.number}|${pr.title}`),
    timestamp: pr.mergedAt,
    ownership: 1.0,
    source: pr.url,
    metadata: {
      title: pr.title,
      additions: pr.additions,
      deletions: pr.deletions,
    },
  };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add packages/skillproof/src/core/evidence.ts packages/skillproof/src/core/evidence.test.ts
git commit -m "feat: add createPREvidence for GitHub pull request evidence"
```

---

### Task 5: Fix scan.ts — file content hashing + blame ownership

**Files:**
- Modify: `packages/skillproof/src/commands/scan.ts`
- Modify: `packages/skillproof/src/commands/scan.test.ts`

**Step 1: Update scan.test.ts**

Replace the entire file — `files` is now an array of objects instead of strings:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEvidence } from "./scan.ts";

describe("scan", () => {
  describe("buildEvidence", () => {
    it("creates commit evidence from git commits", () => {
      const result = buildEvidence({
        commits: [
          { hash: "abc1234", author: "John", email: "j@ex.com", date: "2025-01-01T00:00:00Z", message: "feat: init" },
        ],
        files: [{ path: "src/index.ts", content: "const x = 1;", ownership: 0.75 }],
        dependencies: [{ name: "express", source: "package.json" }],
        configFiles: [],
        pullRequests: [],
      });

      const commitEv = result.find((e) => e.type === "commit");
      assert.ok(commitEv);
      assert.equal(commitEv.id, "EV-COMMIT-abc1234");
    });

    it("hashes actual file content, not file path", () => {
      const result = buildEvidence({
        commits: [],
        files: [{ path: "src/index.ts", content: "const hello = 'world';", ownership: 0.8 }],
        dependencies: [],
        configFiles: [],
        pullRequests: [],
      });

      const fileEv = result.find((e) => e.type === "file");
      assert.ok(fileEv);
      assert.equal(fileEv.source, "src/index.ts");
      assert.equal(fileEv.ownership, 0.8);
      // Hash should be of content, not of file path
      assert.notEqual(fileEv.hash, fileEv.source);
      assert.equal(fileEv.hash.length, 64);
    });

    it("creates dependency evidence", () => {
      const result = buildEvidence({
        commits: [],
        files: [],
        dependencies: [{ name: "redis", source: "package.json" }],
        configFiles: [],
        pullRequests: [],
      });

      const depEv = result.find((e) => e.id === "EV-DEP-redis");
      assert.ok(depEv);
    });

    it("creates PR evidence", () => {
      const result = buildEvidence({
        commits: [],
        files: [],
        dependencies: [],
        configFiles: [],
        pullRequests: [{
          number: 42,
          title: "feat: auth",
          mergedAt: "2025-06-15T10:00:00Z",
          url: "https://github.com/o/r/pull/42",
          additions: 100,
          deletions: 10,
        }],
      });

      const prEv = result.find((e) => e.id === "EV-PR-42");
      assert.ok(prEv);
      assert.equal(prEv.type, "pull_request");
    });

    it("does not include sensitive files", () => {
      const result = buildEvidence({
        commits: [],
        files: [
          { path: "src/index.ts", content: "code", ownership: 1.0 },
        ],
        dependencies: [],
        configFiles: [],
        pullRequests: [],
      });

      const fileEvidence = result.filter((e) => e.type === "file");
      assert.equal(fileEvidence.length, 1);
    });
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Rewrite scan.ts**

Replace the full `scan.ts` content:

```typescript
import type { Evidence } from "../types/manifest.ts";
import type { GitCommit, PullRequest } from "../core/git.ts";
import {
  createCommitEvidence,
  createDependencyEvidence,
  createConfigEvidence,
  createFileEvidence,
  createPREvidence,
} from "../core/evidence.ts";
import { isSensitivePath } from "../core/security.ts";
import {
  getGitLog,
  getGitUser,
  getHeadCommit,
  getRemoteUrl,
  getTrackedFiles,
  getFileOwnership,
  isGhAuthenticated,
  getGitHubUsername,
  getAuthorPRs,
  parseRepoFromRemote,
} from "../core/git.ts";
import {
  createEmptyManifest,
  writeManifest,
  getManifestPath,
} from "../core/manifest.ts";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface ScanInput {
  commits: GitCommit[];
  files: { path: string; content: string; ownership: number }[];
  dependencies: { name: string; source: string }[];
  configFiles: { path: string; content: string }[];
  pullRequests: PullRequest[];
}

export function buildEvidence(input: ScanInput): Evidence[] {
  const evidence: Evidence[] = [];

  for (const commit of input.commits) {
    evidence.push(createCommitEvidence(commit));
  }

  for (const file of input.files) {
    if (!isSensitivePath(file.path)) {
      evidence.push(createFileEvidence(file.path, file.content, file.ownership));
    }
  }

  for (const dep of input.dependencies) {
    evidence.push(createDependencyEvidence(dep.name, dep.source));
  }

  for (const cfg of input.configFiles) {
    evidence.push(createConfigEvidence(cfg.path, cfg.content));
  }

  for (const pr of input.pullRequests) {
    evidence.push(createPREvidence(pr));
  }

  return evidence;
}

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const BLAME_CONCURRENCY = 10;

const CONFIG_PATTERNS = [
  /^Dockerfile/i,
  /^docker-compose/i,
  /\.github\/workflows\//,
  /\.tf$/,
  /helm\//,
  /\.k8s\//,
  /serverless\.(yml|yaml|json)$/,
];

const DEPENDENCY_FILES: Record<string, (content: string) => { name: string }[]> = {
  "package.json": (content) => {
    try {
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return Object.keys(deps || {}).map((name) => ({ name }));
    } catch {
      return [];
    }
  },
  "requirements.txt": (content) =>
    content
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => ({ name: l.split(/[=<>!]/)[0].trim() })),
  "go.mod": (content) => {
    const matches = content.matchAll(/^\s+(\S+)\s/gm);
    return [...matches].map((m) => ({ name: m[1].split("/").pop()! }));
  },
  "Cargo.toml": (content) => {
    const matches = content.matchAll(/^(\w[\w-]*)\s*=/gm);
    return [...matches].map((m) => ({ name: m[1] }));
  },
};

async function batchBlame(
  cwd: string,
  filePaths: string[],
  authorEmail: string
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  for (let i = 0; i < filePaths.length; i += BLAME_CONCURRENCY) {
    const batch = filePaths.slice(i, i + BLAME_CONCURRENCY);
    const ownershipResults = await Promise.all(
      batch.map((fp) => getFileOwnership(cwd, fp, authorEmail))
    );
    batch.forEach((fp, idx) => results.set(fp, ownershipResults[idx]));
  }
  return results;
}

export async function runScan(cwd: string): Promise<void> {
  const user = await getGitUser(cwd);
  const [headCommit, remoteUrl, trackedFiles, commits] = await Promise.all([
    getHeadCommit(cwd),
    getRemoteUrl(cwd),
    getTrackedFiles(cwd),
    getGitLog(cwd, user.email),
  ]);

  // Extract dependencies
  const dependencies: { name: string; source: string }[] = [];
  for (const [filename, parser] of Object.entries(DEPENDENCY_FILES)) {
    if (trackedFiles.includes(filename)) {
      try {
        const content = await readFile(path.join(cwd, filename), "utf8");
        const deps = parser(content);
        dependencies.push(...deps.map((d) => ({ ...d, source: filename })));
      } catch {
        // skip unreadable files
      }
    }
  }

  // Extract config files
  const configFiles: { path: string; content: string }[] = [];
  for (const filePath of trackedFiles) {
    if (CONFIG_PATTERNS.some((p) => p.test(filePath)) && !isSensitivePath(filePath)) {
      try {
        const content = await readFile(path.join(cwd, filePath), "utf8");
        configFiles.push({ path: filePath, content });
      } catch {
        // skip
      }
    }
  }

  // Read file contents + compute blame ownership
  const eligibleFiles = trackedFiles.filter(
    (fp) => !isSensitivePath(fp) && !CONFIG_PATTERNS.some((p) => p.test(fp))
  );

  // Filter by file size
  const sizedFiles: string[] = [];
  for (const fp of eligibleFiles) {
    try {
      const s = await stat(path.join(cwd, fp));
      if (s.size <= MAX_FILE_SIZE) sizedFiles.push(fp);
    } catch {
      // skip
    }
  }

  // Batch blame
  console.log(`Computing ownership for ${sizedFiles.length} files...`);
  const ownershipMap = await batchBlame(cwd, sizedFiles, user.email);

  // Read file contents
  const files: { path: string; content: string; ownership: number }[] = [];
  for (const fp of sizedFiles) {
    try {
      const content = await readFile(path.join(cwd, fp), "utf8");
      files.push({ path: fp, content, ownership: ownershipMap.get(fp) ?? 0 });
    } catch {
      // skip binary/unreadable files
    }
  }

  // GitHub PR evidence (graceful degradation)
  let pullRequests: PullRequest[] = [];
  if (remoteUrl) {
    const repoId = parseRepoFromRemote(remoteUrl);
    if (repoId && await isGhAuthenticated()) {
      console.log("GitHub authenticated. Fetching PR data...");
      const username = await getGitHubUsername();
      if (username) {
        pullRequests = await getAuthorPRs(repoId, username);
        console.log(`Found ${pullRequests.length} merged PRs.`);
      }
    } else {
      console.log("GitHub not authenticated or not a GitHub repo. Skipping PR evidence.");
    }
  }

  const evidence = buildEvidence({
    commits,
    files,
    dependencies,
    configFiles,
    pullRequests,
  });

  const manifest = createEmptyManifest({
    repoUrl: remoteUrl,
    headCommit,
    authorName: user.name,
    authorEmail: user.email,
  });
  manifest.evidence = evidence;

  const manifestPath = getManifestPath(cwd);
  await writeManifest(manifestPath, manifest);

  console.log(`Scan complete. ${evidence.length} evidence items collected.`);
  console.log(`Manifest written to ${manifestPath}`);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof && npm test 2>&1 | tail -20`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof/src/commands/scan.ts packages/skillproof/src/commands/scan.test.ts
git commit -m "fix: read actual file content and compute git blame ownership in scan"
```

---

### Task 6: Add PR-based skill rules to skills.ts

**Files:**
- Modify: `packages/skillproof/src/core/skills.ts`
- Modify: `packages/skillproof/src/core/skills.test.ts`

**Step 1: Write failing test**

Add to `skills.test.ts`:

```typescript
it("infers Code Review from PR evidence", () => {
  const evidence: Evidence[] = [
    {
      id: "EV-PR-42",
      type: "pull_request",
      hash: "abc",
      timestamp: "2025-06-15T10:00:00Z",
      ownership: 1.0,
      source: "https://github.com/o/r/pull/42",
      metadata: { title: "feat: auth", additions: 100, deletions: 10 },
    },
    {
      id: "EV-PR-43",
      type: "pull_request",
      hash: "def",
      timestamp: "2025-06-16T10:00:00Z",
      ownership: 1.0,
      source: "https://github.com/o/r/pull/43",
      metadata: { title: "fix: bug", additions: 20, deletions: 5 },
    },
  ];
  const skills = inferStaticSkills(evidence);
  const codeReview = skills.find((s) => s.name === "Code Review");
  assert.ok(codeReview);
  assert.equal(codeReview.evidence_ids.length, 2);
});
```

**Step 2: Run test to verify it fails**

**Step 3: Add rules to SIGNAL_RULES in skills.ts**

Add at the end of `SIGNAL_RULES` array (before the closing `];`):

```typescript
  // Practices (from PR evidence)
  { skill: "Code Review", match: (ev) => ev.type === "pull_request", confidence: 0.75 },
  { skill: "Collaboration", match: (ev) => ev.type === "pull_request", confidence: 0.70 },
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add packages/skillproof/src/core/skills.ts packages/skillproof/src/core/skills.test.ts
git commit -m "feat: add Code Review and Collaboration skill inference from PR evidence"
```

---

### Task 7: Update integration test

**Files:**
- Modify: `packages/skillproof/src/commands/integration.test.ts`

**Step 1: Update the integration test**

The integration test creates a temp git repo without a GitHub remote, so PR evidence will be skipped. The key change is verifying that file evidence now has real content hashes and ownership < 1.0 is possible (though in a single-author test repo it will be 1.0).

Add after the scan assertion block (after `assert.ok(manifestAfterScan.evidence.length > 0)`):

```typescript
    // Verify file evidence has real content hashes (not path hashes)
    const fileEvidence = manifestAfterScan.evidence.filter(
      (e: { type: string }) => e.type === "file"
    );
    for (const fe of fileEvidence) {
      assert.equal(fe.hash.length, 64, "file evidence should have SHA-256 hash");
      assert.ok(fe.ownership >= 0 && fe.ownership <= 1, "ownership should be 0-1");
    }
```

**Step 2: Run full test suite**

Run: `cd packages/skillproof && npm test 2>&1`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add packages/skillproof/src/commands/integration.test.ts
git commit -m "test: verify file content hashing and ownership in integration test"
```

---

## Task Summary

| Task | Description |
|------|-------------|
| 1 | Add `"pull_request"` to EvidenceType |
| 2 | Add `parseBlameOutput` + `getFileOwnership` to git.ts |
| 3 | Add GitHub PR functions (`parseRepoFromRemote`, `parseGitHubPRs`, `getAuthorPRs`, etc.) |
| 4 | Add `createPREvidence` to evidence.ts |
| 5 | Fix scan.ts — read file content, compute blame ownership, add PR scanning |
| 6 | Add PR-based skill rules (Code Review, Collaboration) |
| 7 | Update integration test to verify real content hashes |
