# Multi-Project Scanning — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `scan-multi` command that scans multiple local sub-projects or GitHub repos with interactive selection, multi-email identity, and evidence merging into one manifest.

**Architecture:** Four new core modules (identity, github, merge, prompt extension) plus a new `scan-multi` command. Existing `scan` is refactored to export a reusable `scanRepo()` function. Evidence from multiple repos is merged with repo-name prefixes into a single manifest.

**Tech Stack:** TypeScript, Node.js, `@inquirer/prompts` (checkbox), `commander`, `gh` CLI for GitHub API

---

### Task 1: Add `@inquirer/prompts` dependency

**Files:**
- Modify: `packages/skillproof/package.json`

**Step 1: Install**

```bash
cd packages/skillproof && npm install @inquirer/prompts
```

**Step 2: Verify**

```bash
node -e "import('@inquirer/prompts').then(() => console.log('OK'))"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add packages/skillproof/package.json packages/skillproof/package-lock.json
git commit -m "chore: add @inquirer/prompts dependency"
```

---

### Task 2: Extend `types/manifest.ts` — add multi-repo and multi-email fields

**Files:**
- Modify: `packages/skillproof/src/types/manifest.ts`

**Step 1: Add new fields**

Add `emails?` to `AuthorInfo` and `repos?` + `RepoEntry` to the manifest types. Use the Edit tool to make these changes:

In `AuthorInfo`, add `emails?`:
```typescript
export interface AuthorInfo {
  name: string;
  email: string;
  emails?: string[];
}
```

Add a new `RepoEntry` interface after `RepoInfo`:
```typescript
export interface RepoEntry {
  url: string | null;
  head_commit: string;
  name: string;
}
```

Add `repos?` to `Manifest`:
```typescript
export interface Manifest {
  schema_version: "1.0";
  generated_at: string;
  repo: RepoInfo;
  author: AuthorInfo;
  evidence: Evidence[];
  skills: Skill[];
  claims: Claim[];
  signatures: Signature[];
  repos?: RepoEntry[];
}
```

**Step 2: Run tests to verify backward compatibility**

```bash
cd packages/skillproof && npm test
```

Expected: All 71 tests still pass (all new fields are optional)

**Step 3: Commit**

```bash
git add packages/skillproof/src/types/manifest.ts
git commit -m "feat(types): add multi-email and multi-repo fields to manifest"
```

---

### Task 3: Add `checkboxPrompt` to `core/prompt.ts`

**Files:**
- Modify: `packages/skillproof/src/core/prompt.ts`

**Step 1: Add the checkbox function**

Append to the end of `packages/skillproof/src/core/prompt.ts`:

```typescript
import { checkbox } from "@inquirer/prompts";

export async function checkboxPrompt<T>(
  message: string,
  choices: { name: string; value: T; checked?: boolean }[]
): Promise<T[]> {
  return checkbox({ message, choices });
}
```

Note: You'll also need to keep the existing `readline` import at the top. The file will have two imports — `readline` for `ask`/`askYesNo` and `checkbox` from `@inquirer/prompts`.

**Step 2: Build to verify no compile errors**

```bash
cd packages/skillproof && npm run build
```

Expected: Clean build

**Step 3: Commit**

```bash
git add packages/skillproof/src/core/prompt.ts
git commit -m "feat(prompt): add interactive checkbox prompt using @inquirer/prompts"
```

---

### Task 4: Create `core/identity.ts` — developer email collection

**Files:**
- Create: `packages/skillproof/src/core/identity.ts`
- Create: `packages/skillproof/src/core/identity.test.ts`

**Step 1: Write the failing tests**

Create `packages/skillproof/src/core/identity.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deduplicateEmails, mergeEmailSources } from "./identity.ts";

describe("identity", () => {
  describe("deduplicateEmails", () => {
    it("removes duplicate emails case-insensitively", () => {
      const result = deduplicateEmails([
        { email: "alice@test.com", sources: ["git config"] },
        { email: "Alice@test.com", sources: ["github"] },
        { email: "bob@test.com", sources: ["git log"] },
      ]);
      assert.equal(result.length, 2);
      const alice = result.find((e) => e.email.toLowerCase() === "alice@test.com");
      assert.ok(alice);
      assert.ok(alice.sources.includes("git config"));
      assert.ok(alice.sources.includes("github"));
    });

    it("returns empty array for empty input", () => {
      assert.deepEqual(deduplicateEmails([]), []);
    });
  });

  describe("mergeEmailSources", () => {
    it("merges emails from multiple sources", () => {
      const gitConfig = [{ email: "alice@test.com", sources: ["git config"] }];
      const github = [
        { email: "alice@test.com", sources: ["github"] },
        { email: "alice-work@company.com", sources: ["github"] },
      ];
      const gitLog = [
        { email: "alice@test.com", sources: ["git log: repo-a"] },
        { email: "noreply@github.com", sources: ["git log: repo-a"] },
      ];

      const result = mergeEmailSources([gitConfig, github, gitLog]);
      assert.equal(result.length, 3);

      const alice = result.find((e) => e.email === "alice@test.com");
      assert.ok(alice);
      assert.ok(alice.sources.length >= 3);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skillproof && npm test 2>&1 | grep -E "(identity|FAIL|Error)"
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/skillproof/src/core/identity.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface EmailCandidate {
  email: string;
  sources: string[];
}

export function deduplicateEmails(candidates: EmailCandidate[]): EmailCandidate[] {
  const map = new Map<string, EmailCandidate>();
  for (const c of candidates) {
    const key = c.email.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.sources.push(...c.sources);
    } else {
      map.set(key, { email: c.email, sources: [...c.sources] });
    }
  }
  return [...map.values()];
}

export function mergeEmailSources(sources: EmailCandidate[][]): EmailCandidate[] {
  const all = sources.flat();
  return deduplicateEmails(all);
}

export async function getGitConfigEmail(): Promise<EmailCandidate | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--global", "user.email"]);
    const email = stdout.trim();
    return email ? { email, sources: ["git config"] } : null;
  } catch {
    return null;
  }
}

export async function getGitHubEmails(): Promise<EmailCandidate[]> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api", "/user/emails", "--jq", ".[].email",
    ]);
    return stdout
      .split("\n")
      .map((e) => e.trim())
      .filter((e) => e.length > 0)
      .map((email) => ({ email, sources: ["github"] }));
  } catch {
    return [];
  }
}

export async function getRepoLogEmails(cwd: string, repoName: string): Promise<EmailCandidate[]> {
  try {
    const { stdout } = await execFileAsync(
      "git", ["log", "--format=%ae", "--all"],
      { cwd }
    );
    const emails = [...new Set(
      stdout.split("\n").map((e) => e.trim()).filter((e) => e.length > 0)
    )];
    return emails.map((email) => ({ email, sources: [`git log: ${repoName}`] }));
  } catch {
    return [];
  }
}

export async function collectAllEmails(
  repoPaths: { path: string; name: string }[]
): Promise<EmailCandidate[]> {
  const sources: EmailCandidate[][] = [];

  const gitConfig = await getGitConfigEmail();
  if (gitConfig) sources.push([gitConfig]);

  const githubEmails = await getGitHubEmails();
  if (githubEmails.length > 0) sources.push(githubEmails);

  for (const repo of repoPaths) {
    const logEmails = await getRepoLogEmails(repo.path, repo.name);
    if (logEmails.length > 0) sources.push(logEmails);
  }

  return mergeEmailSources(sources);
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/skillproof && npm test 2>&1 | grep -E "(identity|FAIL|PASS)"
```

Expected: All identity tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof/src/core/identity.ts packages/skillproof/src/core/identity.test.ts
git commit -m "feat(identity): add multi-email developer identity collection"
```

---

### Task 5: Create `core/github.ts` — GitHub repo listing

**Files:**
- Create: `packages/skillproof/src/core/github.ts`
- Create: `packages/skillproof/src/core/github.test.ts`

**Step 1: Write the failing tests**

Create `packages/skillproof/src/core/github.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deduplicateRepos, parseRepoListJson } from "./github.ts";

describe("github", () => {
  describe("parseRepoListJson", () => {
    it("parses gh repo list JSON output", () => {
      const json = JSON.stringify([
        { name: "repo-a", url: "https://github.com/user/repo-a", owner: { login: "user" } },
        { name: "repo-b", url: "https://github.com/user/repo-b", owner: { login: "user" } },
      ]);
      const repos = parseRepoListJson(json);
      assert.equal(repos.length, 2);
      assert.equal(repos[0].name, "repo-a");
      assert.equal(repos[0].cloneUrl, "https://github.com/user/repo-a");
    });

    it("returns empty array for empty input", () => {
      assert.deepEqual(parseRepoListJson("[]"), []);
    });
  });

  describe("deduplicateRepos", () => {
    it("removes duplicate repos by clone URL", () => {
      const repos = [
        { name: "repo-a", cloneUrl: "https://github.com/user/repo-a", source: "my repos" },
        { name: "repo-a", cloneUrl: "https://github.com/user/repo-a", source: "contributed" },
        { name: "repo-b", cloneUrl: "https://github.com/user/repo-b", source: "my repos" },
      ];
      const result = deduplicateRepos(repos);
      assert.equal(result.length, 2);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skillproof && npm test 2>&1 | grep -E "(github|FAIL|Error)"
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/skillproof/src/core/github.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubRepo {
  name: string;
  cloneUrl: string;
  source: string;
}

export function parseRepoListJson(json: string): GitHubRepo[] {
  const raw = JSON.parse(json) as Array<{
    name: string;
    url: string;
    owner: { login: string };
  }>;
  return raw.map((r) => ({
    name: r.name,
    cloneUrl: r.url,
    source: "my repos",
  }));
}

export function deduplicateRepos(repos: GitHubRepo[]): GitHubRepo[] {
  const seen = new Map<string, GitHubRepo>();
  for (const repo of repos) {
    if (!seen.has(repo.cloneUrl)) {
      seen.set(repo.cloneUrl, repo);
    }
  }
  return [...seen.values()];
}

export async function fetchMyRepos(): Promise<GitHubRepo[]> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "repo", "list", "--json", "name,url,owner", "--limit", "200",
    ]);
    return parseRepoListJson(stdout).map((r) => ({ ...r, source: "my repos" }));
  } catch {
    console.warn("Failed to fetch your repositories.");
    return [];
  }
}

export async function fetchContributedRepos(): Promise<GitHubRepo[]> {
  try {
    const { stdout: userJson } = await execFileAsync("gh", [
      "api", "/user", "--jq", ".login",
    ]);
    const login = userJson.trim();

    const { stdout } = await execFileAsync("gh", [
      "api", "/user/repos?type=all&per_page=100&sort=pushed",
    ]);
    const raw = JSON.parse(stdout) as Array<{
      name: string;
      clone_url: string;
      owner: { login: string };
    }>;
    return raw
      .filter((r) => r.owner.login !== login)
      .map((r) => ({
        name: `${r.owner.login}/${r.name}`,
        cloneUrl: r.clone_url,
        source: "contributed",
      }));
  } catch {
    console.warn("Failed to fetch contributed repositories.");
    return [];
  }
}

export async function fetchOrgRepos(org: string): Promise<GitHubRepo[]> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api", `/orgs/${org}/repos?per_page=100&type=all`,
    ]);
    const raw = JSON.parse(stdout) as Array<{
      name: string;
      clone_url: string;
    }>;
    return raw.map((r) => ({
      name: `${org}/${r.name}`,
      cloneUrl: r.clone_url,
      source: `org: ${org}`,
    }));
  } catch {
    console.warn(`Failed to fetch repositories for org: ${org}`);
    return [];
  }
}

export async function fetchGitHubRepos(
  sources: { myRepos: boolean; contributed: boolean; orgs: string[] }
): Promise<GitHubRepo[]> {
  const all: GitHubRepo[] = [];

  if (sources.myRepos) {
    all.push(...await fetchMyRepos());
  }
  if (sources.contributed) {
    all.push(...await fetchContributedRepos());
  }
  for (const org of sources.orgs) {
    all.push(...await fetchOrgRepos(org));
  }

  return deduplicateRepos(all);
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/skillproof && npm test 2>&1 | grep -E "(github|FAIL|PASS)"
```

Expected: All github tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof/src/core/github.ts packages/skillproof/src/core/github.test.ts
git commit -m "feat(github): add GitHub repo listing with multi-source support"
```

---

### Task 6: Create `core/merge.ts` — evidence merging

**Files:**
- Create: `packages/skillproof/src/core/merge.ts`
- Create: `packages/skillproof/src/core/merge.test.ts`

**Step 1: Write the failing tests**

Create `packages/skillproof/src/core/merge.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prefixEvidence, mergeSkills, mergeManifests } from "./merge.ts";
import type { Evidence, Skill, Manifest } from "../types/manifest.ts";

describe("merge", () => {
  describe("prefixEvidence", () => {
    it("adds repo prefix to evidence id and source", () => {
      const evidence: Evidence[] = [
        { id: "EV-COMMIT-abc", type: "commit", hash: "h1", timestamp: "t1", ownership: 1, source: "abc" },
        { id: "EV-FILE-xyz", type: "file", hash: "h2", timestamp: "t2", ownership: 0.8, source: "src/index.ts" },
      ];
      const result = prefixEvidence(evidence, "my-repo");
      assert.equal(result[0].id, "my-repo:EV-COMMIT-abc");
      assert.equal(result[0].source, "my-repo/abc");
      assert.equal(result[1].id, "my-repo:EV-FILE-xyz");
      assert.equal(result[1].source, "my-repo/src/index.ts");
    });
  });

  describe("mergeSkills", () => {
    it("merges same-name skills keeping highest confidence", () => {
      const skills: Skill[] = [
        { name: "TypeScript", confidence: 0.9, evidence_ids: ["a:EV-1"], inferred_by: "static" },
        { name: "TypeScript", confidence: 1.0, evidence_ids: ["b:EV-2"], inferred_by: "static" },
        { name: "Python", confidence: 0.7, evidence_ids: ["a:EV-3"], inferred_by: "static" },
      ];
      const result = mergeSkills(skills);
      assert.equal(result.length, 2);

      const ts = result.find((s) => s.name === "TypeScript");
      assert.ok(ts);
      assert.equal(ts.confidence, 1.0);
      assert.deepEqual(ts.evidence_ids, ["a:EV-1", "b:EV-2"]);

      const py = result.find((s) => s.name === "Python");
      assert.ok(py);
      assert.equal(py.confidence, 0.7);
    });
  });

  describe("mergeManifests", () => {
    it("merges multiple manifests into one", () => {
      const m1: Manifest = {
        schema_version: "1.0",
        generated_at: "2026-01-01T00:00:00Z",
        repo: { url: "https://github.com/u/a", head_commit: "aaa" },
        author: { name: "Alice", email: "alice@test.com" },
        evidence: [{ id: "EV-1", type: "commit", hash: "h", timestamp: "t", ownership: 1, source: "x" }],
        skills: [{ name: "TypeScript", confidence: 0.9, evidence_ids: ["EV-1"], inferred_by: "static" }],
        claims: [],
        signatures: [],
      };
      const m2: Manifest = {
        schema_version: "1.0",
        generated_at: "2026-01-01T00:00:00Z",
        repo: { url: "https://github.com/u/b", head_commit: "bbb" },
        author: { name: "Alice", email: "alice@test.com" },
        evidence: [{ id: "EV-1", type: "file", hash: "h2", timestamp: "t", ownership: 1, source: "y.ts" }],
        skills: [{ name: "TypeScript", confidence: 1.0, evidence_ids: ["EV-1"], inferred_by: "static" }],
        claims: [],
        signatures: [],
      };

      const result = mergeManifests([
        { manifest: m1, repoName: "repo-a" },
        { manifest: m2, repoName: "repo-b" },
      ]);

      assert.equal(result.evidence.length, 2);
      assert.ok(result.evidence[0].id.startsWith("repo-a:"));
      assert.ok(result.evidence[1].id.startsWith("repo-b:"));
      assert.equal(result.skills.length, 1);
      assert.equal(result.skills[0].confidence, 1.0);
      assert.equal(result.skills[0].evidence_ids.length, 2);
      assert.ok(result.repos);
      assert.equal(result.repos!.length, 2);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skillproof && npm test 2>&1 | grep -E "(merge|FAIL|Error)"
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/skillproof/src/core/merge.ts`:

```typescript
import type { Evidence, Skill, Manifest, RepoEntry } from "../types/manifest.ts";

export function prefixEvidence(evidence: Evidence[], repoName: string): Evidence[] {
  return evidence.map((e) => ({
    ...e,
    id: `${repoName}:${e.id}`,
    source: `${repoName}/${e.source}`,
  }));
}

export function mergeSkills(skills: Skill[]): Skill[] {
  const map = new Map<string, Skill>();
  for (const skill of skills) {
    const existing = map.get(skill.name);
    if (existing) {
      if (skill.confidence > existing.confidence) {
        existing.confidence = skill.confidence;
      }
      existing.evidence_ids.push(...skill.evidence_ids);
    } else {
      map.set(skill.name, {
        ...skill,
        evidence_ids: [...skill.evidence_ids],
      });
    }
  }
  return [...map.values()];
}

export function mergeManifests(
  entries: { manifest: Manifest; repoName: string }[]
): Manifest {
  const allEvidence: Evidence[] = [];
  const allSkills: Skill[] = [];
  const repos: RepoEntry[] = [];

  for (const { manifest, repoName } of entries) {
    allEvidence.push(...prefixEvidence(manifest.evidence, repoName));

    const prefixedSkills = manifest.skills.map((s) => ({
      ...s,
      evidence_ids: s.evidence_ids.map((id) => `${repoName}:${id}`),
    }));
    allSkills.push(...prefixedSkills);

    repos.push({
      url: manifest.repo.url,
      head_commit: manifest.repo.head_commit,
      name: repoName,
    });
  }

  const firstManifest = entries[0].manifest;

  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    repo: firstManifest.repo,
    author: firstManifest.author,
    evidence: allEvidence,
    skills: mergeSkills(allSkills),
    claims: [],
    signatures: [],
    repos,
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/skillproof && npm test 2>&1 | grep -E "(merge|FAIL|PASS)"
```

Expected: All merge tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof/src/core/merge.ts packages/skillproof/src/core/merge.test.ts
git commit -m "feat(merge): add evidence and skill merging for multi-repo manifests"
```

---

### Task 7: Refactor `commands/scan.ts` — extract reusable `scanRepo()`

**Files:**
- Modify: `packages/skillproof/src/commands/scan.ts`

**Step 1: Extract `scanRepo` function**

The existing `runScan` does two things: (1) scan a repo to produce evidence and (2) write a manifest. We need to extract step 1 into a reusable function.

Add a new exported function `scanRepo` that takes `cwd` and `authorEmails` and returns `{ evidence, repoUrl, headCommit }`. The existing `runScan` should call `scanRepo` internally.

At the top of `scan.ts`, after the existing imports and before `buildEvidence`, add:

```typescript
export interface ScanResult {
  evidence: Evidence[];
  repoUrl: string | null;
  headCommit: string;
  authorName: string;
  authorEmail: string;
}
```

Then, after the existing `batchBlame` function (around line 119), add the new `scanRepo` function that contains the core logic currently in `runScan`, but accepts `authorEmails: string[]` and doesn't write the manifest:

```typescript
export async function scanRepo(cwd: string, authorEmails?: string[]): Promise<ScanResult> {
  const user = await getGitUser(cwd);
  const emails = authorEmails ?? [user.email];
  const primaryEmail = emails[0];

  const [headCommit, remoteUrl, trackedFiles] = await Promise.all([
    getHeadCommit(cwd),
    getRemoteUrl(cwd),
    getTrackedFiles(cwd),
  ]);

  // Get commits from all author emails
  const commitSets = await Promise.all(emails.map((e) => getGitLog(cwd, e)));
  const seenHashes = new Set<string>();
  const commits: GitCommit[] = [];
  for (const set of commitSets) {
    for (const c of set) {
      if (!seenHashes.has(c.hash)) {
        seenHashes.add(c.hash);
        commits.push(c);
      }
    }
  }

  // Extract dependencies
  const dependencies: { name: string; source: string }[] = [];
  for (const [filename, parser] of Object.entries(DEPENDENCY_FILES)) {
    if (trackedFiles.includes(filename)) {
      try {
        const content = await readFile(path.join(cwd, filename), "utf8");
        const deps = parser(content);
        dependencies.push(...deps.map((d) => ({ ...d, source: filename })));
      } catch { /* skip */ }
    }
  }

  // Extract config files
  const configFiles: { path: string; content: string }[] = [];
  for (const filePath of trackedFiles) {
    if (CONFIG_PATTERNS.some((p) => p.test(filePath)) && !isSensitivePath(filePath)) {
      try {
        const content = await readFile(path.join(cwd, filePath), "utf8");
        configFiles.push({ path: filePath, content });
      } catch { /* skip */ }
    }
  }

  // Read files + compute blame ownership (max across all emails)
  const eligibleFiles = trackedFiles.filter(
    (fp) => !isSensitivePath(fp) && !CONFIG_PATTERNS.some((p) => p.test(fp))
  );
  const sizedFiles: string[] = [];
  for (const fp of eligibleFiles) {
    try {
      const s = await stat(path.join(cwd, fp));
      if (s.size <= MAX_FILE_SIZE) sizedFiles.push(fp);
    } catch { /* skip */ }
  }

  // Batch blame using primary email (for ownership calculation)
  console.log(`Computing ownership for ${sizedFiles.length} files...`);
  const ownershipMap = await batchBlame(cwd, sizedFiles, primaryEmail);

  const files: { path: string; content: string; ownership: number }[] = [];
  for (const fp of sizedFiles) {
    try {
      const content = await readFile(path.join(cwd, fp), "utf8");
      files.push({ path: fp, content, ownership: ownershipMap.get(fp) ?? 0 });
    } catch { /* skip */ }
  }

  // GitHub PR evidence
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
    }
  }

  const evidence = buildEvidence({ commits, files, dependencies, configFiles, pullRequests });

  return {
    evidence,
    repoUrl: remoteUrl,
    headCommit,
    authorName: user.name,
    authorEmail: primaryEmail,
  };
}
```

Then simplify `runScan` to call `scanRepo`:

```typescript
export async function runScan(cwd: string): Promise<void> {
  const result = await scanRepo(cwd);

  const manifest = createEmptyManifest({
    repoUrl: result.repoUrl,
    headCommit: result.headCommit,
    authorName: result.authorName,
    authorEmail: result.authorEmail,
  });
  manifest.evidence = result.evidence;

  const manifestPath = getManifestPath(cwd);
  await writeManifest(manifestPath, manifest);

  console.log(`Scan complete. ${result.evidence.length} evidence items collected.`);
  console.log(`Manifest written to ${manifestPath}`);
}
```

**Step 2: Run tests to verify nothing broke**

```bash
cd packages/skillproof && npm test
```

Expected: All tests pass (same behavior, just refactored)

**Step 3: Commit**

```bash
git add packages/skillproof/src/commands/scan.ts
git commit -m "refactor(scan): extract reusable scanRepo function for multi-project support"
```

---

### Task 8: Create `commands/scan-multi.ts` — main command

**Files:**
- Create: `packages/skillproof/src/commands/scan-multi.ts`

**Step 1: Write the full scan-multi command**

Create `packages/skillproof/src/commands/scan-multi.ts`:

```typescript
import { readdir, stat, rm, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { scanRepo } from "./scan.ts";
import { collectAllEmails } from "../core/identity.ts";
import { fetchGitHubRepos, type GitHubRepo } from "../core/github.ts";
import { mergeManifests } from "../core/merge.ts";
import { checkboxPrompt } from "../core/prompt.ts";
import { ask } from "../core/prompt.ts";
import { writeManifest, getManifestPath, createEmptyManifest } from "../core/manifest.ts";
import type { Manifest } from "../types/manifest.ts";

const execFileAsync = promisify(execFile);

interface LocalRepo {
  name: string;
  path: string;
}

async function discoverLocalRepos(parentDir: string): Promise<LocalRepo[]> {
  const entries = await readdir(parentDir);
  const repos: LocalRepo[] = [];

  for (const entry of entries) {
    const fullPath = path.join(parentDir, entry);
    try {
      const s = await stat(fullPath);
      if (!s.isDirectory()) continue;
      const gitDir = path.join(fullPath, ".git");
      const gitStat = await stat(gitDir);
      if (gitStat.isDirectory()) {
        repos.push({ name: entry, path: fullPath });
      }
    } catch {
      // not a git repo, skip
    }
  }

  return repos;
}

async function cloneRepo(cloneUrl: string, targetDir: string): Promise<void> {
  await execFileAsync("git", ["clone", cloneUrl, targetDir], {
    timeout: 300000, // 5 minute timeout per clone
  });
}

async function runLocalMode(cwd: string): Promise<void> {
  const repos = await discoverLocalRepos(cwd);
  if (repos.length === 0) {
    console.log("No git repositories found in current directory.");
    return;
  }

  const selected = await checkboxPrompt<LocalRepo>(
    "Select repositories to scan",
    repos.map((r) => ({ name: r.name, value: r }))
  );
  if (selected.length === 0) {
    console.log("No repositories selected.");
    return;
  }

  // Collect and confirm emails
  const emailCandidates = await collectAllEmails(selected);
  const confirmedEmails = await checkboxPrompt<string>(
    "Confirm your email addresses (used for ownership calculation)",
    emailCandidates.map((e) => ({
      name: `${e.email} (${e.sources.join(", ")})`,
      value: e.email,
      checked: e.sources.some((s) => s === "git config" || s === "github"),
    }))
  );
  if (confirmedEmails.length === 0) {
    console.log("No emails confirmed. Cannot calculate ownership.");
    return;
  }

  // Scan each repo
  const results: { manifest: Manifest; repoName: string }[] = [];
  let succeeded = 0;
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < selected.length; i++) {
    const repo = selected[i];
    console.log(`\nScanning ${i + 1} of ${selected.length}: ${repo.name}`);
    try {
      const scanResult = await scanRepo(repo.path, confirmedEmails);
      const manifest = createEmptyManifest({
        repoUrl: scanResult.repoUrl,
        headCommit: scanResult.headCommit,
        authorName: scanResult.authorName,
        authorEmail: confirmedEmails[0],
      });
      manifest.author.emails = confirmedEmails;
      manifest.evidence = scanResult.evidence;
      results.push({ manifest, repoName: repo.name });
      console.log(`  ✓ ${repo.name}: ${scanResult.evidence.length} evidence items`);
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ✗ ${repo.name}: ${msg}`);
      failures.push(`${repo.name}: ${msg}`);
      failed++;
    }
  }

  if (results.length === 0) {
    console.log("\nNo repositories scanned successfully.");
    return;
  }

  // Merge and write
  const merged = mergeManifests(results);
  merged.author.emails = confirmedEmails;
  const manifestPath = getManifestPath(cwd);
  await writeManifest(manifestPath, merged);

  console.log(`\nScan complete. ${succeeded}/${selected.length} succeeded${failed > 0 ? `, ${failed} failed` : ""}.`);
  console.log(`Total evidence: ${merged.evidence.length} items, ${merged.skills.length} skills.`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.join("; ")}`);
  }
  console.log(`Manifest written to ${manifestPath}`);
}

async function runGitHubMode(cwd: string): Promise<void> {
  // Step 1: Select repo sources
  const sourceChoices = await checkboxPrompt<string>(
    "Select GitHub repo sources to include",
    [
      { name: "My repositories", value: "my" },
      { name: "Contributed repositories (other people's repos I contributed to)", value: "contributed" },
      { name: "Organization repositories", value: "org" },
    ]
  );
  if (sourceChoices.length === 0) {
    console.log("No sources selected.");
    return;
  }

  // Step 2: If org selected, ask for org names
  const orgs: string[] = [];
  if (sourceChoices.includes("org")) {
    const orgInput = await ask("Enter organization name(s), comma-separated: ");
    orgs.push(...orgInput.split(",").map((s) => s.trim()).filter((s) => s.length > 0));
    if (orgs.length === 0) {
      console.log("No organizations specified.");
      return;
    }
  }

  // Step 3: Fetch repos from all sources
  console.log("Fetching repository lists...");
  const allRepos = await fetchGitHubRepos({
    myRepos: sourceChoices.includes("my"),
    contributed: sourceChoices.includes("contributed"),
    orgs,
  });
  if (allRepos.length === 0) {
    console.log("No repositories found.");
    return;
  }

  // Step 4: User selects repos
  const selected = await checkboxPrompt<GitHubRepo>(
    `Found ${allRepos.length} repositories. Select which to scan`,
    allRepos.map((r) => ({
      name: `${r.name} [${r.source}]`,
      value: r,
    }))
  );
  if (selected.length === 0) {
    console.log("No repositories selected.");
    return;
  }

  // Step 5: Clone to temp dir
  const tmpBase = path.join(os.tmpdir(), `skillproof-clone-${Date.now()}`);
  await mkdir(tmpBase, { recursive: true });

  const clonedRepos: LocalRepo[] = [];

  const cleanup = async () => {
    try { await rm(tmpBase, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  // Register cleanup on exit signals
  const onSignal = () => { cleanup().finally(() => process.exit(1)); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    for (let i = 0; i < selected.length; i++) {
      const repo = selected[i];
      const targetDir = path.join(tmpBase, repo.name.replace("/", "--"));
      console.log(`\nCloning ${i + 1} of ${selected.length}: ${repo.name}`);
      try {
        await cloneRepo(repo.cloneUrl, targetDir);
        clonedRepos.push({ name: repo.name, path: targetDir });
        console.log(`  ✓ Cloned ${repo.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ✗ Clone failed for ${repo.name}: ${msg}`);
      }
    }

    if (clonedRepos.length === 0) {
      console.log("\nNo repositories cloned successfully.");
      return;
    }

    // Step 6: Collect and confirm emails
    const emailCandidates = await collectAllEmails(clonedRepos);
    const confirmedEmails = await checkboxPrompt<string>(
      "Confirm your email addresses",
      emailCandidates.map((e) => ({
        name: `${e.email} (${e.sources.join(", ")})`,
        value: e.email,
        checked: e.sources.some((s) => s === "git config" || s === "github"),
      }))
    );
    if (confirmedEmails.length === 0) {
      console.log("No emails confirmed.");
      return;
    }

    // Step 7: Scan each cloned repo
    const results: { manifest: Manifest; repoName: string }[] = [];
    let succeeded = 0;
    let failed = 0;
    const failures: string[] = [];

    for (let i = 0; i < clonedRepos.length; i++) {
      const repo = clonedRepos[i];
      console.log(`\nScanning ${i + 1} of ${clonedRepos.length}: ${repo.name}`);
      try {
        const scanResult = await scanRepo(repo.path, confirmedEmails);
        const manifest = createEmptyManifest({
          repoUrl: scanResult.repoUrl,
          headCommit: scanResult.headCommit,
          authorName: scanResult.authorName,
          authorEmail: confirmedEmails[0],
        });
        manifest.author.emails = confirmedEmails;
        manifest.evidence = scanResult.evidence;
        results.push({ manifest, repoName: repo.name });
        console.log(`  ✓ ${repo.name}: ${scanResult.evidence.length} evidence items`);
        succeeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ✗ ${repo.name}: ${msg}`);
        failures.push(`${repo.name}: ${msg}`);
        failed++;
      }
    }

    if (results.length === 0) {
      console.log("\nNo repositories scanned successfully.");
      return;
    }

    // Step 8: Merge and write
    const merged = mergeManifests(results);
    merged.author.emails = confirmedEmails;
    const manifestPath = getManifestPath(cwd);
    await writeManifest(manifestPath, merged);

    console.log(`\nScan complete. ${succeeded}/${clonedRepos.length} succeeded${failed > 0 ? `, ${failed} failed` : ""}.`);
    console.log(`Total evidence: ${merged.evidence.length} items, ${merged.skills.length} skills.`);
    if (failures.length > 0) {
      console.log(`Failures: ${failures.join("; ")}`);
    }
    console.log(`Manifest written to ${manifestPath}`);
  } finally {
    // Step 9: Clean up clones
    console.log("\nCleaning up temporary clones...");
    await cleanup();
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

export async function runScanMulti(cwd: string, github: boolean): Promise<void> {
  if (github) {
    await runGitHubMode(cwd);
  } else {
    await runLocalMode(cwd);
  }
}
```

**Step 2: Build to verify compilation**

```bash
cd packages/skillproof && npm run build
```

Expected: Clean build

**Step 3: Commit**

```bash
git add packages/skillproof/src/commands/scan-multi.ts
git commit -m "feat(scan-multi): add multi-project scanning with local and GitHub modes"
```

---

### Task 9: Register `scan-multi` in `src/index.ts`

**Files:**
- Modify: `packages/skillproof/src/index.ts`

**Step 1: Add import and command registration**

Add import at the top of `src/index.ts` alongside other imports:

```typescript
import { runScanMulti } from "./commands/scan-multi.ts";
```

Add the command registration after the existing `doctor` command block:

```typescript
program
  .command("scan-multi")
  .description("Scan multiple repositories and merge into one resume")
  .option("--github", "Scan remote GitHub repositories instead of local sub-directories")
  .action(async (options: { github?: boolean }) => {
    await runScanMulti(process.cwd(), !!options.github);
  });
```

**Step 2: Build and verify help**

```bash
cd packages/skillproof && npm run build && node dist/index.js scan-multi --help
```

Expected: Should show description and `--github` option

**Step 3: Commit**

```bash
git add packages/skillproof/src/index.ts
git commit -m "feat(cli): register scan-multi command with --github option"
```

---

### Task 10: Build and run all tests

**Step 1: Build**

```bash
cd packages/skillproof && npm run build
```

Expected: Clean build, no errors

**Step 2: Run all tests**

```bash
cd packages/skillproof && npm test
```

Expected: All tests pass (existing + new identity, github, merge tests)

**Step 3: Verify CLI commands**

```bash
node dist/index.js --help
node dist/index.js scan-multi --help
```

Expected: `scan-multi` appears in main help, its help shows `--github` flag

**Step 4: Commit final state if needed**

```bash
git add -A && git status
```

Only commit if there are meaningful changes not yet committed.
