# Codex Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 7 main issues and 2 UX improvements identified in the Codex code review.

**Architecture:** Pure bugfix batch — no new features, no structural changes. Each fix is isolated to 1-2 files plus tests.

**Tech Stack:** TypeScript, node:test, Commander.js

---

### Task 1: Fix PR author filtering in getAuthorPRs

**Files:**
- Modify: `packages/veriresume-cli/src/core/git.ts:173-189`
- Test: `packages/veriresume-cli/src/core/git.test.ts`

**Step 1: Write the failing test**

Add to `git.test.ts` inside the `parseGitHubPRs` describe block:

```typescript
it("parseGitHubPRs filters by author login when provided", () => {
  const json = JSON.stringify([
    {
      number: 1,
      title: "my PR",
      merged_at: "2025-06-15T10:00:00Z",
      html_url: "https://github.com/o/r/pull/1",
      additions: 10,
      deletions: 5,
      user: { login: "john" },
    },
    {
      number: 2,
      title: "someone else PR",
      merged_at: "2025-06-16T10:00:00Z",
      html_url: "https://github.com/o/r/pull/2",
      additions: 20,
      deletions: 3,
      user: { login: "jane" },
    },
  ]);

  const prs = parseGitHubPRs(json, "john");
  assert.equal(prs.length, 1);
  assert.equal(prs[0].number, 1);
});

it("parseGitHubPRs returns all merged when no author filter", () => {
  const json = JSON.stringify([
    {
      number: 1, title: "a", merged_at: "2025-06-15T10:00:00Z",
      html_url: "url1", additions: 10, deletions: 5, user: { login: "john" },
    },
    {
      number: 2, title: "b", merged_at: "2025-06-16T10:00:00Z",
      html_url: "url2", additions: 20, deletions: 3, user: { login: "jane" },
    },
  ]);

  const prs = parseGitHubPRs(json);
  assert.equal(prs.length, 2);
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && npx tsx --test src/core/git.test.ts`
Expected: FAIL — `parseGitHubPRs` doesn't accept a second argument

**Step 3: Implement the fix**

In `git.ts`, modify `parseGitHubPRs` to accept optional `authorLogin` and filter:

```typescript
export function parseGitHubPRs(json: string, authorLogin?: string): PullRequest[] {
  const raw = JSON.parse(json) as Array<{
    number: number;
    title: string;
    merged_at: string | null;
    html_url: string;
    additions: number;
    deletions: number;
    user: { login: string };
  }>;

  return raw
    .filter((pr) => pr.merged_at !== null)
    .filter((pr) => !authorLogin || pr.user.login === authorLogin)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      mergedAt: pr.merged_at!,
      url: pr.html_url,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
    }));
}
```

Then update `getAuthorPRs` to pass `authorLogin` through:

```typescript
export async function getAuthorPRs(
  repoId: RepoId,
  authorLogin: string
): Promise<PullRequest[]> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api",
      `repos/${repoId.owner}/${repoId.repo}/pulls?state=closed&per_page=100`,
    ]);
    return parseGitHubPRs(stdout, authorLogin);
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && npx tsx --test src/core/git.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/core/git.ts packages/veriresume-cli/src/core/git.test.ts
git commit -m "fix: filter PR evidence by author login"
```

---

### Task 2: Add resume.md integrity check to verify

**Files:**
- Modify: `packages/veriresume-cli/src/commands/pack.ts:19-24`
- Modify: `packages/veriresume-cli/src/commands/verify.ts:18-54`
- Test: `packages/veriresume-cli/src/commands/verify.test.ts`

**Step 1: Write the failing test**

Add to `verify.test.ts`:

```typescript
it("detects tampered resume.md", async () => {
  const manifest = createEmptyManifest({
    repoUrl: null,
    headCommit: "abc",
    authorName: "Test",
    authorEmail: "test@example.com",
  });

  const keysDir = path.join(tempDir, ".veriresume", "keys");
  const keys = await generateKeyPair(keysDir);

  const manifestForSign = { ...manifest, signatures: [] as Signature[] };
  const content = canonicalJson(manifestForSign);
  const sig = signManifest(content, keys.privateKey);
  manifest.signatures = [{
    signer: "candidate",
    public_key: Buffer.from(keys.publicKey).toString("base64"),
    signature: sig,
    timestamp: new Date().toISOString(),
    algorithm: "Ed25519",
  }];

  const manifestPath = path.join(tempDir, ".veriresume", "resume-manifest.json");
  await writeManifest(manifestPath, manifest);
  await writeFile(path.join(tempDir, "resume.md"), "# Original\n", "utf8");

  await runPack(tempDir);

  // Tamper with resume.md inside the bundle
  const bundlePath = path.join(tempDir, "bundle.zip");
  const tamperDir = await mkdtemp(path.join(tmpdir(), "veriresume-tamper-"));
  const { execFile: ef } = await import("node:child_process");
  const { promisify: p } = await import("node:util");
  const execFileAsync = p(ef);
  await execFileAsync("unzip", ["-o", bundlePath, "-d", tamperDir]);
  await writeFile(path.join(tamperDir, "resume.md"), "# TAMPERED\n", "utf8");
  // Re-zip
  const { rm: rmFile } = await import("node:fs/promises");
  await rmFile(bundlePath);
  await execFileAsync("zip", ["-j", bundlePath,
    path.join(tamperDir, "resume.md"),
    path.join(tamperDir, "resume-manifest.json"),
    path.join(tamperDir, "verification.json"),
  ]);
  await rmFile(tamperDir, { recursive: true });

  const result = await verifyBundle(bundlePath);
  assert.equal(result.valid, false);
  assert.ok(result.resumeTampered);
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/verify.test.ts`
Expected: FAIL — `resumeTampered` property doesn't exist

**Step 3: Implement the fix**

In `pack.ts`, add `resume_hash` to verification.json:

```typescript
const resumeContent = await readFile(resumePath, "utf8");
const verification = {
  instructions: "To verify this resume bundle, use: veriresume verify bundle.zip",
  manifest_hash: hashContent(manifestContent),
  resume_hash: hashContent(resumeContent),
  signature_count: manifest.signatures?.length || 0,
  generated_at: manifest.generated_at,
};
```

In `verify.ts`, add `resumeTampered` to `VerifyResult` and check resume.md hash:

```typescript
export interface VerifyResult {
  valid: boolean;
  signatures: { signer: string; valid: boolean; error?: string }[];
  manifestHash: string;
  resumeTampered: boolean;
}

export async function verifyBundle(bundlePath: string): Promise<VerifyResult> {
  const extractDir = await mkdtemp(path.join(tmpdir(), "veriresume-verify-"));

  try {
    await execFileAsync("unzip", ["-o", bundlePath, "-d", extractDir]);

    const manifestContent = await readFile(
      path.join(extractDir, "resume-manifest.json"), "utf8"
    );
    const manifest: Manifest = JSON.parse(manifestContent);

    const manifestForVerify = { ...manifest, signatures: [] as Signature[] };
    const canonicalContent = canonicalJson(manifestForVerify);
    const manifestHash = hashContent(canonicalContent);

    // Check resume.md integrity via verification.json
    let resumeTampered = false;
    try {
      const verificationContent = await readFile(
        path.join(extractDir, "verification.json"), "utf8"
      );
      const verification = JSON.parse(verificationContent);
      if (verification.resume_hash) {
        const resumeContent = await readFile(
          path.join(extractDir, "resume.md"), "utf8"
        );
        const actualHash = hashContent(resumeContent);
        resumeTampered = actualHash !== verification.resume_hash;
      }
    } catch {
      // verification.json missing or resume.md missing — treat as tampered
      resumeTampered = true;
    }

    const sigResults = manifest.signatures.map((sig) => {
      try {
        const publicKeyPem = Buffer.from(sig.public_key, "base64").toString("utf8");
        const valid = verifySignature(canonicalContent, sig.signature, publicKeyPem);
        return { signer: sig.signer, valid };
      } catch (err) {
        return { signer: sig.signer, valid: false, error: String(err) };
      }
    });

    const allSigsValid = sigResults.length > 0 && sigResults.every((s) => s.valid);

    return {
      valid: allSigsValid && !resumeTampered,
      signatures: sigResults,
      manifestHash,
      resumeTampered,
    };
  } finally {
    await rm(extractDir, { recursive: true });
  }
}
```

Also update `runVerify` to print tampering status:

```typescript
if (result.resumeTampered) {
  console.log(`\nWARNING: resume.md has been tampered with!`);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/verify.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/commands/pack.ts packages/veriresume-cli/src/commands/verify.ts packages/veriresume-cli/src/commands/verify.test.ts
git commit -m "fix: verify resume.md integrity via verification.json hash"
```

---

### Task 3: Fix parseRepoFromRemote to handle dots in repo names

**Files:**
- Modify: `packages/veriresume-cli/src/core/git.ts:123-131`
- Test: `packages/veriresume-cli/src/core/git.test.ts`

**Step 1: Write the failing test**

Add to `git.test.ts` inside `parseRepoFromRemote` describe:

```typescript
it("parses repo name with dots", () => {
  const result = parseRepoFromRemote("https://github.com/owner/my.repo.git");
  assert.deepEqual(result, { owner: "owner", repo: "my.repo" });
});

it("parses SSH repo name with dots", () => {
  const result = parseRepoFromRemote("git@github.com:owner/my.repo.git");
  assert.deepEqual(result, { owner: "owner", repo: "my.repo" });
});

it("parses HTTPS without .git suffix", () => {
  const result = parseRepoFromRemote("https://github.com/owner/my.repo");
  assert.deepEqual(result, { owner: "owner", repo: "my.repo" });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && npx tsx --test src/core/git.test.ts`
Expected: FAIL — repo name truncated to "my"

**Step 3: Implement the fix**

In `git.ts`, change the regex to allow dots in repo names, only stripping trailing `.git`:

```typescript
export function parseRepoFromRemote(remoteUrl: string): RepoId | null {
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && npx tsx --test src/core/git.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/core/git.ts packages/veriresume-cli/src/core/git.test.ts
git commit -m "fix: handle dots in GitHub repo names"
```

---

### Task 4: Fix Cargo.toml dependency parser to be section-aware

**Files:**
- Modify: `packages/veriresume-cli/src/commands/scan.ts:99-102`
- Test: `packages/veriresume-cli/src/commands/scan.test.ts`

**Step 1: Write the failing test**

Add a new describe block in `scan.test.ts`:

```typescript
describe("DEPENDENCY_FILES parsers", () => {
  it("Cargo.toml only parses [dependencies] and [dev-dependencies]", () => {
    // We need to test the parser directly. Import it or extract.
    // Since DEPENDENCY_FILES is not exported, test via buildEvidence with known content.
    // Better: extract and export the parser. But for minimal change, test the behavior.
    const cargoContent = [
      "[package]",
      'name = "my-app"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'serde = "1.0"',
      'tokio = { version = "1", features = ["full"] }',
      "",
      "[dev-dependencies]",
      'criterion = "0.5"',
      "",
      "[profile.release]",
      "opt-level = 3",
    ].join("\n");

    const deps = parseCargoDeps(cargoContent);
    const names = deps.map((d) => d.name);
    assert.ok(names.includes("serde"));
    assert.ok(names.includes("tokio"));
    assert.ok(names.includes("criterion"));
    assert.ok(!names.includes("name"));
    assert.ok(!names.includes("version"));
    assert.ok(!names.includes("edition"));
    assert.ok(!names.includes("opt-level"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/scan.test.ts`
Expected: FAIL — `parseCargoDeps` not exported

**Step 3: Implement the fix**

In `scan.ts`, extract the Cargo.toml parser and make it section-aware. Export it for testing:

```typescript
export function parseCargoDeps(content: string): { name: string }[] {
  const deps: { name: string }[] = [];
  let inDepSection = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inDepSection = trimmed === "[dependencies]" || trimmed === "[dev-dependencies]"
        || trimmed === "[build-dependencies]";
      continue;
    }
    if (!inDepSection) continue;
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([\w][\w-]*)\s*=/);
    if (match) {
      deps.push({ name: match[1] });
    }
  }

  return deps;
}
```

Update the `DEPENDENCY_FILES` map entry:

```typescript
"Cargo.toml": (content) => parseCargoDeps(content),
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/scan.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/commands/scan.ts packages/veriresume-cli/src/commands/scan.test.ts
git commit -m "fix: Cargo.toml parser only extracts dependency sections"
```

---

### Task 5: Wire containsSecrets() into scan file reading

**Files:**
- Modify: `packages/veriresume-cli/src/commands/scan.ts:206-214`
- Test: `packages/veriresume-cli/src/commands/scan.test.ts`

**Step 1: Write the failing test**

Add to `scan.test.ts`:

```typescript
it("excludes files containing secrets from evidence", () => {
  const result = buildEvidence({
    commits: [],
    files: [
      { path: "src/index.ts", content: "const x = 1;", ownership: 0.8 },
      { path: "src/config.ts", content: "const key = 'AKIAIOSFODNN7EXAMPLE';", ownership: 0.9 },
    ],
    dependencies: [],
    configFiles: [],
    pullRequests: [],
  });

  const fileEvidence = result.filter((e) => e.type === "file");
  assert.equal(fileEvidence.length, 1);
  assert.equal(fileEvidence[0].source, "src/index.ts");
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/scan.test.ts`
Expected: FAIL — both files included (containsSecrets not called in buildEvidence)

**Step 3: Implement the fix**

In `scan.ts`, import `containsSecrets` and add content check in `buildEvidence`:

```typescript
import { isSensitivePath, containsSecrets } from "../core/security.ts";
```

Update the file loop in `buildEvidence`:

```typescript
for (const file of input.files) {
  if (!isSensitivePath(file.path) && !containsSecrets(file.content)) {
    evidence.push(createFileEvidence(file.path, file.content, file.ownership));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/scan.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/commands/scan.ts packages/veriresume-cli/src/commands/scan.test.ts
git commit -m "fix: wire containsSecrets() into evidence collection"
```

---

### Task 6: Fix scan-multi to recursively discover repos

**Files:**
- Modify: `packages/veriresume-cli/src/commands/scan-multi.ts:21-41`
- Test: `packages/veriresume-cli/src/commands/scan-multi.test.ts`

**Step 1: Write the failing test**

Add to `scan-multi.test.ts` — first export `discoverLocalRepos`:

```typescript
it("finds nested git repos (not just one level)", async () => {
  const { mkdir, rm, stat } = await import("node:fs/promises");
  const parentDir = path.join(os.tmpdir(), `veriresume-nested-${Date.now()}`);
  await mkdir(parentDir, { recursive: true });

  // Create nested structure: parent/group/repo-c/.git
  await mkdir(path.join(parentDir, "group", "repo-c", ".git"), { recursive: true });
  // Also create top-level: parent/repo-d/.git
  await mkdir(path.join(parentDir, "repo-d", ".git"), { recursive: true });

  try {
    const repos = await discoverLocalRepos(parentDir);
    const names = repos.map((r) => r.name).sort();
    assert.ok(names.includes("repo-d"), "should find top-level repo");
    assert.ok(names.includes("repo-c"), "should find nested repo");
    assert.equal(repos.length, 2);
  } finally {
    await rm(parentDir, { recursive: true, force: true });
  }
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/scan-multi.test.ts`
Expected: FAIL — `discoverLocalRepos` not exported, and only finds one level

**Step 3: Implement the fix**

In `scan-multi.ts`, export `discoverLocalRepos` and make it recursive:

```typescript
export async function discoverLocalRepos(parentDir: string): Promise<LocalRepo[]> {
  const repos: LocalRepo[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const s = await stat(fullPath);
        if (!s.isDirectory()) continue;
        const gitDir = path.join(fullPath, ".git");
        try {
          const gitStat = await stat(gitDir);
          if (gitStat.isDirectory()) {
            repos.push({ name: entry, path: fullPath });
            // Don't recurse into git repos
            continue;
          }
        } catch {
          // No .git here, recurse deeper
        }
        await walk(fullPath);
      } catch {
        // skip unreadable entries
      }
    }
  }

  await walk(parentDir);
  return repos;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/scan-multi.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/commands/scan-multi.ts packages/veriresume-cli/src/commands/scan-multi.test.ts
git commit -m "fix: scan-multi recursively discovers nested git repos"
```

---

### Task 7: Auto-detect rendered files in pack

**Files:**
- Modify: `packages/veriresume-cli/src/commands/pack.ts:8-50`
- Test: `packages/veriresume-cli/src/commands/pack.test.ts`

**Step 1: Write the failing test**

Add to `pack.test.ts`:

```typescript
it("includes rendered resume files (pdf/png) in bundle", async () => {
  const manifest = createEmptyManifest({
    repoUrl: null,
    headCommit: "abc",
    authorName: "Test",
    authorEmail: "test@example.com",
  });

  const manifestPath = path.join(tempDir, ".veriresume", "resume-manifest.json");
  await writeManifest(manifestPath, manifest);
  await writeFile(path.join(tempDir, "resume.md"), "# Test Resume\n", "utf8");
  await writeFile(path.join(tempDir, "resume.pdf"), "fake-pdf-content", "utf8");

  await runPack(tempDir);

  // Extract and verify
  const { execFile: ef } = await import("node:child_process");
  const { promisify: p } = await import("node:util");
  const execFileAsync = p(ef);
  const extractDir = path.join(tempDir, "extracted");
  await execFileAsync("unzip", ["-o", path.join(tempDir, "bundle.zip"), "-d", extractDir]);

  const files = await readdir(extractDir);
  assert.ok(files.includes("resume.md"));
  assert.ok(files.includes("resume.pdf"));
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/pack.test.ts`
Expected: FAIL — resume.pdf not in bundle

**Step 3: Implement the fix**

In `pack.ts`, auto-detect and include rendered resume files:

```typescript
import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { getManifestPath } from "../core/manifest.ts";
import { hashContent } from "../core/hashing.ts";

const RESUME_FORMATS = ["resume.md", "resume.pdf", "resume.png", "resume.jpg", "resume.jpeg"];

export async function runPack(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const bundlePath = path.join(cwd, "bundle.zip");

  await access(manifestPath);

  // Find which resume files exist
  const resumeFiles: string[] = [];
  for (const filename of RESUME_FORMATS) {
    const filePath = path.join(cwd, filename);
    try {
      await access(filePath);
      resumeFiles.push(filename);
    } catch {
      // file doesn't exist, skip
    }
  }

  if (resumeFiles.length === 0) {
    throw new Error("No resume file found. Run 'veriresume render' first.");
  }

  const manifestContent = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestContent);

  // Build file hashes for verification
  const fileHashes: Record<string, string> = {};
  for (const filename of resumeFiles) {
    const content = await readFile(path.join(cwd, filename));
    fileHashes[filename] = hashContent(content.toString("utf8"));
  }

  const verification = {
    instructions: "To verify this resume bundle, use: veriresume verify bundle.zip",
    manifest_hash: hashContent(manifestContent),
    resume_hash: fileHashes["resume.md"] || null,
    file_hashes: fileHashes,
    signature_count: manifest.signatures?.length || 0,
    generated_at: manifest.generated_at,
  };

  return new Promise((resolve, reject) => {
    const output = createWriteStream(bundlePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`Bundle created: ${bundlePath} (${archive.pointer()} bytes)`);
      console.log(`Included: ${resumeFiles.join(", ")}`);
      resolve();
    });

    archive.on("error", reject);
    archive.pipe(output);

    for (const filename of resumeFiles) {
      archive.file(path.join(cwd, filename), { name: filename });
    }
    archive.file(manifestPath, { name: "resume-manifest.json" });
    archive.append(JSON.stringify(verification, null, 2), { name: "verification.json" });

    for (const sig of manifest.signatures || []) {
      archive.append(JSON.stringify(sig, null, 2), {
        name: `signatures/${sig.signer}-${sig.timestamp.replace(/[:.]/g, "-")}.json`,
      });
    }

    archive.finalize();
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/pack.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/veriresume-cli/src/commands/pack.ts packages/veriresume-cli/src/commands/pack.test.ts
git commit -m "fix: pack auto-includes rendered resume files (pdf/png/jpeg)"
```

---

### Task 8: Add CI-friendly flags to render command

**Files:**
- Modify: `packages/veriresume-cli/src/commands/render.ts:60-103`
- Modify: `packages/veriresume-cli/src/index.ts:36-45`

**Step 1: Add CLI options in index.ts**

```typescript
.option("--api-key <key>", "Anthropic API key (skips interactive prompt)")
.option("--personal-info <info>", "Personal info to include (skips interactive prompt)")
.option("--yes", "Skip confirmation prompts (CI mode)")
```

Update the action signature to pass these through:

```typescript
.action(async (localeArg, options) => {
  const locale = localeArg || options.locale;
  await runRender(process.cwd(), locale, options.format, options.output, {
    apiKey: options.apiKey,
    personalInfo: options.personalInfo,
    yes: options.yes,
  });
});
```

**Step 2: Update runRender signature**

In `render.ts`:

```typescript
export interface RenderOptions {
  apiKey?: string;
  personalInfo?: string;
  yes?: boolean;
}

export async function runRender(
  cwd: string,
  locale?: string,
  format?: string,
  output?: string,
  options?: RenderOptions,
): Promise<void> {
```

When `locale` is set, use options to skip prompts:

```typescript
const apiKey = options?.apiKey || await resolveApiKeyInteractive(cwd);

let personalInfo: string | null = null;
if (options?.personalInfo !== undefined) {
  personalInfo = options.personalInfo || null;
} else if (!options?.yes) {
  const personalInfoResponse = await ask(
    "Would you like to include a personal introduction or work experience?\n(Type your info, or 'skip' to continue): "
  );
  personalInfo = personalInfoResponse.toLowerCase() === "skip" ? null : personalInfoResponse || null;
}
```

**Step 3: Run tests**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/render.test.ts`
Expected: PASS (existing tests don't call runRender, only renderResume)

**Step 4: Commit**

```bash
git add packages/veriresume-cli/src/commands/render.ts packages/veriresume-cli/src/index.ts
git commit -m "feat: add --api-key, --personal-info, --yes flags to render for CI"
```

---

### Task 9: Fix inferred_by label to use "static" for rule-based detection

**Files:**
- Modify: `packages/veriresume-cli/src/commands/infer.ts:45`

**Step 1: Fix the label**

In `infer.ts`, line 45, change:

```typescript
inferred_by: "llm" as const,
```

to:

```typescript
inferred_by: "static" as const,
```

**Step 2: Run tests**

Run: `cd packages/veriresume-cli && npx tsx --test src/commands/infer.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/veriresume-cli/src/commands/infer.ts
git commit -m "fix: inferred_by uses 'static' for rule-based detection"
```

---

### Task 10: Run full test suite and squash into single commit

**Step 1: Run all tests**

Run: `cd packages/veriresume-cli && npm test`
Expected: All tests pass

**Step 2: Squash commits**

```bash
git rebase -i HEAD~9
# Squash all into one commit
git commit --amend -m "fix: address all Codex code review findings

- Filter PR evidence by author login (git.ts)
- Verify resume.md integrity via verification.json hash (verify.ts, pack.ts)
- Handle dots in GitHub repo names (git.ts)
- Section-aware Cargo.toml dependency parsing (scan.ts)
- Wire containsSecrets() into evidence collection (scan.ts)
- Recursive repo discovery in scan-multi (scan-multi.ts)
- Auto-include rendered files in pack bundle (pack.ts)
- Add --api-key, --personal-info, --yes flags to render (render.ts, index.ts)
- Fix inferred_by label to 'static' for rule detection (infer.ts)"
```
