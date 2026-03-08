# SkillProof Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Claude Code plugin that scans git repos, extracts verifiable evidence, infers skills, and generates a cryptographically signed resume bundle.

**Architecture:** Thin TypeScript CLI handles deterministic operations (git parsing, hashing, signing, bundling). Claude Code skill (SKILL.md) handles LLM-powered reasoning. Slash commands invoke the skill which orchestrates the CLI.

**Tech Stack:** TypeScript, Node.js crypto (Ed25519, SHA-256), commander.js, archiver (zip), Node.js built-in test runner

---

### Task 1: Project Scaffolding

**Files:**
- Create: `packages/skillproof-cli/package.json`
- Create: `packages/skillproof-cli/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "skillproof-cli",
  "version": "0.1.0",
  "description": "Generate verifiable developer resumes from source code",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "skillproof": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "node --test --experimental-strip-types --test-reporter spec 'src/**/*.test.ts'",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "archiver": "^7.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/archiver": "^6.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

**Step 3: Install dependencies**

Run: `cd packages/skillproof-cli && npm install`
Expected: node_modules created, package-lock.json generated

**Step 4: Verify TypeScript compiles**

Create a minimal `src/index.ts`:
```typescript
#!/usr/bin/env node
console.log("skillproof");
```

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/skillproof-cli/package.json packages/skillproof-cli/tsconfig.json packages/skillproof-cli/package-lock.json packages/skillproof-cli/src/index.ts
git commit -m "chore: scaffold skillproof-cli package"
```

---

### Task 2: Type Definitions

**Files:**
- Create: `packages/skillproof-cli/src/types/manifest.ts`

**Step 1: Write type definitions**

```typescript
export type EvidenceType = "commit" | "file" | "snippet" | "dependency" | "config";

export interface Evidence {
  id: string;
  type: EvidenceType;
  hash: string;
  timestamp: string;
  ownership: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export type SkillInferenceMethod = "static" | "llm";

export interface Skill {
  name: string;
  confidence: number;
  evidence_ids: string[];
  inferred_by: SkillInferenceMethod;
}

export type ClaimCategory = "language" | "framework" | "infrastructure" | "tool" | "practice";

export interface Claim {
  id: string;
  category: ClaimCategory;
  skill: string;
  confidence: number;
  evidence_ids: string[];
}

export type SignerType = "candidate" | "ci" | "policy";

export interface Signature {
  signer: SignerType;
  public_key: string;
  signature: string;
  timestamp: string;
  algorithm: "Ed25519";
}

export interface RepoInfo {
  url: string | null;
  head_commit: string;
}

export interface AuthorInfo {
  name: string;
  email: string;
}

export interface Manifest {
  schema_version: "1.0";
  generated_at: string;
  repo: RepoInfo;
  author: AuthorInfo;
  evidence: Evidence[];
  skills: Skill[];
  claims: Claim[];
  signatures: Signature[];
}
```

**Step 2: Verify it compiles**

Run: `cd packages/skillproof-cli && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/skillproof-cli/src/types/manifest.ts
git commit -m "feat: add manifest type definitions"
```

---

### Task 3: Hashing Module

**Files:**
- Create: `packages/skillproof-cli/src/core/hashing.ts`
- Create: `packages/skillproof-cli/src/core/hashing.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashContent, hashFile, canonicalJson } from "./hashing.js";

describe("hashing", () => {
  describe("hashContent", () => {
    it("returns consistent SHA-256 hex for same input", () => {
      const hash1 = hashContent("hello world");
      const hash2 = hashContent("hello world");
      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64); // SHA-256 hex = 64 chars
    });

    it("returns different hashes for different input", () => {
      const hash1 = hashContent("hello");
      const hash2 = hashContent("world");
      assert.notEqual(hash1, hash2);
    });
  });

  describe("canonicalJson", () => {
    it("sorts keys deterministically", () => {
      const obj1 = { b: 2, a: 1 };
      const obj2 = { a: 1, b: 2 };
      assert.equal(canonicalJson(obj1), canonicalJson(obj2));
    });

    it("produces no whitespace", () => {
      const result = canonicalJson({ a: 1, b: [2, 3] });
      assert.ok(!result.includes(" "));
      assert.ok(!result.includes("\n"));
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern hashing`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf8");
  return hashContent(content);
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern hashing`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/core/hashing.ts packages/skillproof-cli/src/core/hashing.test.ts
git commit -m "feat: add hashing module with SHA-256 and canonical JSON"
```

---

### Task 4: Security Module

**Files:**
- Create: `packages/skillproof-cli/src/core/security.ts`
- Create: `packages/skillproof-cli/src/core/security.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSensitivePath, containsSecrets } from "./security.js";

describe("security", () => {
  describe("isSensitivePath", () => {
    it("blocks .env files", () => {
      assert.equal(isSensitivePath(".env"), true);
      assert.equal(isSensitivePath("config/.env.local"), true);
    });

    it("blocks key files", () => {
      assert.equal(isSensitivePath("server.pem"), true);
      assert.equal(isSensitivePath("id_rsa"), true);
      assert.equal(isSensitivePath("secrets/private.key"), true);
    });

    it("blocks credential files", () => {
      assert.equal(isSensitivePath("credentials.json"), true);
      assert.equal(isSensitivePath("aws-credentials"), true);
    });

    it("allows normal files", () => {
      assert.equal(isSensitivePath("src/index.ts"), false);
      assert.equal(isSensitivePath("package.json"), false);
      assert.equal(isSensitivePath("README.md"), false);
    });
  });

  describe("containsSecrets", () => {
    it("detects AWS access keys", () => {
      assert.equal(containsSecrets("key = AKIAIOSFODNN7EXAMPLE"), true);
    });

    it("detects private key headers", () => {
      assert.equal(containsSecrets("-----BEGIN RSA PRIVATE KEY-----"), true);
      assert.equal(containsSecrets("-----BEGIN EC PRIVATE KEY-----"), true);
    });

    it("allows normal code", () => {
      assert.equal(containsSecrets("const x = 42;"), false);
      assert.equal(containsSecrets("import redis from 'redis';"), false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern security`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import path from "node:path";

const SENSITIVE_PATTERNS = [
  /\.env($|\.)/,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
  /credential/i,
  /secret/i,
  /\.p12$/,
  /\.pfx$/,
];

export function isSensitivePath(filePath: string): boolean {
  const basename = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, "/");
  return SENSITIVE_PATTERNS.some(
    (p) => p.test(basename) || p.test(normalized)
  );
}

const SECRET_CONTENT_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN\s+\w*\s*PRIVATE KEY-----/,
  /ghp_[a-zA-Z0-9]{36}/,
  /sk-[a-zA-Z0-9]{32,}/,
];

export function containsSecrets(content: string): boolean {
  return SECRET_CONTENT_PATTERNS.some((p) => p.test(content));
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern security`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/core/security.ts packages/skillproof-cli/src/core/security.test.ts
git commit -m "feat: add security module with sensitive path and secret detection"
```

---

### Task 5: Git Module

**Files:**
- Create: `packages/skillproof-cli/src/core/git.ts`
- Create: `packages/skillproof-cli/src/core/git.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGitLog, GitCommit } from "./git.js";

describe("git", () => {
  describe("parseGitLog", () => {
    it("parses a single commit line", () => {
      const raw = "abc1234|John Doe|john@example.com|2025-01-15T10:30:00Z|feat: add login";
      const commits = parseGitLog(raw);
      assert.equal(commits.length, 1);
      assert.deepEqual(commits[0], {
        hash: "abc1234",
        author: "John Doe",
        email: "john@example.com",
        date: "2025-01-15T10:30:00Z",
        message: "feat: add login",
      });
    });

    it("parses multiple commits", () => {
      const raw = [
        "abc1234|John|john@ex.com|2025-01-15T10:00:00Z|feat: add A",
        "def5678|John|john@ex.com|2025-01-16T10:00:00Z|fix: fix B",
      ].join("\n");
      const commits = parseGitLog(raw);
      assert.equal(commits.length, 2);
    });

    it("handles empty input", () => {
      assert.deepEqual(parseGitLog(""), []);
      assert.deepEqual(parseGitLog("\n"), []);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern git`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export function parseGitLog(raw: string): GitCommit[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [hash, author, email, date, ...messageParts] = line.split("|");
      return {
        hash,
        author,
        email,
        date,
        message: messageParts.join("|"),
      };
    });
}

export async function getGitLog(
  cwd: string,
  authorEmail: string
): Promise<GitCommit[]> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "log",
      `--author=${authorEmail}`,
      "--pretty=format:%h|%an|%ae|%aI|%s",
      "--no-merges",
    ],
    { cwd }
  );
  return parseGitLog(stdout);
}

export async function getHeadCommit(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
  return stdout.trim();
}

export async function getRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["remote", "get-url", "origin"],
      { cwd }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getGitUser(
  cwd: string
): Promise<{ name: string; email: string }> {
  const [{ stdout: name }, { stdout: email }] = await Promise.all([
    execFileAsync("git", ["config", "user.name"], { cwd }),
    execFileAsync("git", ["config", "user.email"], { cwd }),
  ]);
  return { name: name.trim(), email: email.trim() };
}

export async function getTrackedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files"], { cwd });
  return stdout.split("\n").filter((f) => f.trim().length > 0);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern git`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/core/git.ts packages/skillproof-cli/src/core/git.test.ts
git commit -m "feat: add git module with log parsing and repo queries"
```

---

### Task 6: Evidence Module

**Files:**
- Create: `packages/skillproof-cli/src/core/evidence.ts`
- Create: `packages/skillproof-cli/src/core/evidence.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCommitEvidence,
  createDependencyEvidence,
  createConfigEvidence,
} from "./evidence.js";

describe("evidence", () => {
  describe("createCommitEvidence", () => {
    it("creates evidence with correct id format", () => {
      const ev = createCommitEvidence({
        hash: "abc1234",
        author: "John",
        email: "john@ex.com",
        date: "2025-01-15T10:00:00Z",
        message: "feat: add login",
      });
      assert.equal(ev.id, "EV-COMMIT-abc1234");
      assert.equal(ev.type, "commit");
      assert.equal(ev.timestamp, "2025-01-15T10:00:00Z");
      assert.equal(ev.source, "abc1234");
      assert.ok(ev.hash.length === 64);
    });
  });

  describe("createDependencyEvidence", () => {
    it("creates evidence for a dependency", () => {
      const ev = createDependencyEvidence("redis", "package.json");
      assert.equal(ev.id, "EV-DEP-redis");
      assert.equal(ev.type, "dependency");
      assert.equal(ev.source, "package.json");
      assert.equal(ev.ownership, 1.0);
    });
  });

  describe("createConfigEvidence", () => {
    it("creates evidence for a config file", () => {
      const ev = createConfigEvidence("Dockerfile", "FROM node:20\nRUN npm install");
      assert.equal(ev.type, "config");
      assert.ok(ev.id.startsWith("EV-CONFIG-"));
      assert.equal(ev.source, "Dockerfile");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern evidence`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import type { Evidence } from "../types/manifest.js";
import type { GitCommit } from "./git.js";
import { hashContent } from "./hashing.js";

export function createCommitEvidence(commit: GitCommit): Evidence {
  return {
    id: `EV-COMMIT-${commit.hash}`,
    type: "commit",
    hash: hashContent(`${commit.hash}|${commit.message}`),
    timestamp: commit.date,
    ownership: 1.0,
    source: commit.hash,
    metadata: { message: commit.message },
  };
}

export function createFileEvidence(
  filePath: string,
  content: string,
  ownership: number
): Evidence {
  const hash = hashContent(content);
  return {
    id: `EV-FILE-${hash.substring(0, 12)}`,
    type: "file",
    hash,
    timestamp: new Date().toISOString(),
    ownership,
    source: filePath,
  };
}

export function createDependencyEvidence(
  name: string,
  sourceFile: string
): Evidence {
  return {
    id: `EV-DEP-${name}`,
    type: "dependency",
    hash: hashContent(name),
    timestamp: new Date().toISOString(),
    ownership: 1.0,
    source: sourceFile,
  };
}

export function createConfigEvidence(
  filePath: string,
  content: string
): Evidence {
  const hash = hashContent(content);
  return {
    id: `EV-CONFIG-${hash.substring(0, 12)}`,
    type: "config",
    hash,
    timestamp: new Date().toISOString(),
    ownership: 1.0,
    source: filePath,
  };
}

export function createSnippetEvidence(
  filePath: string,
  snippet: string,
  ownership: number
): Evidence {
  const hash = hashContent(snippet);
  return {
    id: `EV-SNIPPET-${hash.substring(0, 12)}`,
    type: "snippet",
    hash,
    timestamp: new Date().toISOString(),
    ownership,
    source: filePath,
    metadata: { lines: snippet.split("\n").length },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern evidence`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/core/evidence.ts packages/skillproof-cli/src/core/evidence.test.ts
git commit -m "feat: add evidence module with factory functions for all evidence types"
```

---

### Task 7: Manifest Module

**Files:**
- Create: `packages/skillproof-cli/src/core/manifest.ts`
- Create: `packages/skillproof-cli/src/core/manifest.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createEmptyManifest,
  writeManifest,
  readManifest,
} from "./manifest.js";

describe("manifest", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("createEmptyManifest", () => {
    it("creates a valid empty manifest", () => {
      const m = createEmptyManifest({
        repoUrl: "https://github.com/test/repo",
        headCommit: "abc123",
        authorName: "John",
        authorEmail: "john@example.com",
      });
      assert.equal(m.schema_version, "1.0");
      assert.equal(m.repo.url, "https://github.com/test/repo");
      assert.equal(m.repo.head_commit, "abc123");
      assert.equal(m.author.name, "John");
      assert.deepEqual(m.evidence, []);
      assert.deepEqual(m.skills, []);
      assert.deepEqual(m.claims, []);
      assert.deepEqual(m.signatures, []);
    });
  });

  describe("writeManifest / readManifest", () => {
    it("round-trips a manifest through the filesystem", async () => {
      const m = createEmptyManifest({
        repoUrl: null,
        headCommit: "def456",
        authorName: "Jane",
        authorEmail: "jane@example.com",
      });
      const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
      await writeManifest(manifestPath, m);

      const loaded = await readManifest(manifestPath);
      assert.deepEqual(loaded.repo.head_commit, "def456");
      assert.deepEqual(loaded.author.name, "Jane");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern manifest`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Manifest } from "../types/manifest.js";

export interface ManifestInit {
  repoUrl: string | null;
  headCommit: string;
  authorName: string;
  authorEmail: string;
}

export function createEmptyManifest(init: ManifestInit): Manifest {
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    repo: {
      url: init.repoUrl,
      head_commit: init.headCommit,
    },
    author: {
      name: init.authorName,
      email: init.authorEmail,
    },
    evidence: [],
    skills: [],
    claims: [],
    signatures: [],
  };
}

export async function writeManifest(
  filePath: string,
  manifest: Manifest
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(manifest, null, 2), "utf8");
}

export async function readManifest(filePath: string): Promise<Manifest> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as Manifest;
}

export function getManifestPath(repoRoot: string): string {
  return path.join(repoRoot, ".skillproof", "resume-manifest.json");
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern manifest`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/core/manifest.ts packages/skillproof-cli/src/core/manifest.test.ts
git commit -m "feat: add manifest module with create, read, write operations"
```

---

### Task 8: Skills (Static Signal) Module

**Files:**
- Create: `packages/skillproof-cli/src/core/skills.ts`
- Create: `packages/skillproof-cli/src/core/skills.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferStaticSkills } from "./skills.js";
import type { Evidence } from "../types/manifest.js";

describe("skills", () => {
  describe("inferStaticSkills", () => {
    it("infers Docker from Dockerfile evidence", () => {
      const evidence: Evidence[] = [
        {
          id: "EV-CONFIG-abc",
          type: "config",
          hash: "abc",
          timestamp: "2025-01-01T00:00:00Z",
          ownership: 1.0,
          source: "Dockerfile",
        },
      ];
      const skills = inferStaticSkills(evidence);
      const docker = skills.find((s) => s.name === "Docker");
      assert.ok(docker);
      assert.equal(docker.inferred_by, "static");
      assert.ok(docker.evidence_ids.includes("EV-CONFIG-abc"));
    });

    it("infers Redis from dependency evidence", () => {
      const evidence: Evidence[] = [
        {
          id: "EV-DEP-redis",
          type: "dependency",
          hash: "def",
          timestamp: "2025-01-01T00:00:00Z",
          ownership: 1.0,
          source: "package.json",
        },
      ];
      const skills = inferStaticSkills(evidence);
      const redis = skills.find((s) => s.name === "Redis");
      assert.ok(redis);
    });

    it("infers TypeScript from .ts file evidence", () => {
      const evidence: Evidence[] = [
        {
          id: "EV-FILE-xyz",
          type: "file",
          hash: "xyz",
          timestamp: "2025-01-01T00:00:00Z",
          ownership: 0.8,
          source: "src/index.ts",
        },
      ];
      const skills = inferStaticSkills(evidence);
      const ts = skills.find((s) => s.name === "TypeScript");
      assert.ok(ts);
    });

    it("returns empty for no matching signals", () => {
      const evidence: Evidence[] = [
        {
          id: "EV-FILE-abc",
          type: "file",
          hash: "abc",
          timestamp: "2025-01-01T00:00:00Z",
          ownership: 1.0,
          source: "README.md",
        },
      ];
      const skills = inferStaticSkills(evidence);
      assert.equal(skills.length, 0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern skills`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import type { Evidence, Skill } from "../types/manifest.js";

interface SignalRule {
  skill: string;
  match: (ev: Evidence) => boolean;
  confidence: number;
}

const SIGNAL_RULES: SignalRule[] = [
  // Infrastructure
  { skill: "Docker", match: (ev) => /dockerfile/i.test(ev.source) || /docker-compose/i.test(ev.source), confidence: 0.85 },
  { skill: "Kubernetes", match: (ev) => /helm/i.test(ev.source) || /k8s/i.test(ev.source) || ev.source.endsWith(".yaml") && /kind:\s*(Deployment|Service|Pod)/i.test(ev.source), confidence: 0.80 },
  { skill: "Terraform", match: (ev) => /\.tf$/.test(ev.source) || ev.id === "EV-DEP-terraform", confidence: 0.80 },
  { skill: "GitHub Actions", match: (ev) => ev.source.includes(".github/workflows/"), confidence: 0.75 },

  // Cloud
  { skill: "AWS", match: (ev) => /aws-sdk|@aws-sdk/i.test(ev.id) || /aws/i.test(ev.source), confidence: 0.75 },

  // Databases & caches
  { skill: "Redis", match: (ev) => /redis/i.test(ev.id) || /redis/i.test(ev.source), confidence: 0.80 },
  { skill: "PostgreSQL", match: (ev) => /pg|postgres|sequelize|prisma|typeorm/i.test(ev.id), confidence: 0.75 },
  { skill: "MongoDB", match: (ev) => /mongo|mongoose/i.test(ev.id), confidence: 0.75 },

  // Languages (by file extension)
  { skill: "TypeScript", match: (ev) => ev.type === "file" && /\.tsx?$/.test(ev.source), confidence: 0.90 },
  { skill: "JavaScript", match: (ev) => ev.type === "file" && /\.jsx?$/.test(ev.source), confidence: 0.90 },
  { skill: "Python", match: (ev) => ev.type === "file" && /\.py$/.test(ev.source), confidence: 0.90 },
  { skill: "Go", match: (ev) => ev.type === "file" && /\.go$/.test(ev.source), confidence: 0.90 },
  { skill: "Rust", match: (ev) => ev.type === "file" && /\.rs$/.test(ev.source), confidence: 0.90 },
  { skill: "Java", match: (ev) => ev.type === "file" && /\.java$/.test(ev.source), confidence: 0.90 },

  // Frameworks
  { skill: "React", match: (ev) => /react/i.test(ev.id) || (ev.type === "file" && /\.tsx$/.test(ev.source)), confidence: 0.80 },
  { skill: "Next.js", match: (ev) => /next/i.test(ev.id) || ev.source === "next.config.js" || ev.source === "next.config.mjs", confidence: 0.80 },
  { skill: "Express", match: (ev) => /express/i.test(ev.id), confidence: 0.80 },
  { skill: "FastAPI", match: (ev) => /fastapi/i.test(ev.id), confidence: 0.80 },

  // Tools
  { skill: "GraphQL", match: (ev) => /graphql|apollo/i.test(ev.id) || /\.graphql$/.test(ev.source), confidence: 0.80 },
];

export function inferStaticSkills(evidence: Evidence[]): Skill[] {
  const skillMap = new Map<string, { confidence: number; evidenceIds: string[] }>();

  for (const ev of evidence) {
    for (const rule of SIGNAL_RULES) {
      if (rule.match(ev)) {
        const existing = skillMap.get(rule.skill);
        if (existing) {
          existing.evidenceIds.push(ev.id);
          existing.confidence = Math.min(
            1.0,
            existing.confidence + 0.02 * (existing.evidenceIds.length - 1)
          );
        } else {
          skillMap.set(rule.skill, {
            confidence: rule.confidence,
            evidenceIds: [ev.id],
          });
        }
      }
    }
  }

  return Array.from(skillMap.entries()).map(([name, data]) => ({
    name,
    confidence: Math.round(data.confidence * 100) / 100,
    evidence_ids: data.evidenceIds,
    inferred_by: "static" as const,
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern skills`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/core/skills.ts packages/skillproof-cli/src/core/skills.test.ts
git commit -m "feat: add static skill inference engine with signal rules"
```

---

### Task 9: Scan Command

**Files:**
- Create: `packages/skillproof-cli/src/commands/scan.ts`
- Create: `packages/skillproof-cli/src/commands/scan.test.ts`

**Step 1: Write the failing test**

This command integrates git + evidence + manifest + security. We test the core orchestration logic with a helper function that takes pre-parsed data rather than requiring a real git repo.

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEvidence } from "./scan.js";

describe("scan", () => {
  describe("buildEvidence", () => {
    it("creates commit evidence from git commits", () => {
      const result = buildEvidence({
        commits: [
          { hash: "abc1234", author: "John", email: "j@ex.com", date: "2025-01-01T00:00:00Z", message: "feat: init" },
        ],
        files: ["src/index.ts"],
        dependencies: [{ name: "express", source: "package.json" }],
        configFiles: [],
      });

      const commitEv = result.find((e) => e.type === "commit");
      assert.ok(commitEv);
      assert.equal(commitEv.id, "EV-COMMIT-abc1234");
    });

    it("creates dependency evidence", () => {
      const result = buildEvidence({
        commits: [],
        files: [],
        dependencies: [{ name: "redis", source: "package.json" }],
        configFiles: [],
      });

      const depEv = result.find((e) => e.id === "EV-DEP-redis");
      assert.ok(depEv);
    });

    it("filters out sensitive files", () => {
      const result = buildEvidence({
        commits: [],
        files: [".env", "src/index.ts", "id_rsa"],
        dependencies: [],
        configFiles: [],
      });

      const fileEvidence = result.filter((e) => e.type === "file");
      assert.equal(fileEvidence.length, 1);
      assert.equal(fileEvidence[0].source, "src/index.ts");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern scan`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import type { Evidence } from "../types/manifest.js";
import type { GitCommit } from "../core/git.js";
import {
  createCommitEvidence,
  createDependencyEvidence,
  createConfigEvidence,
  createFileEvidence,
} from "../core/evidence.js";
import { isSensitivePath } from "../core/security.js";
import { hashContent } from "../core/hashing.js";
import {
  getGitLog,
  getGitUser,
  getHeadCommit,
  getRemoteUrl,
  getTrackedFiles,
} from "../core/git.js";
import {
  createEmptyManifest,
  writeManifest,
  getManifestPath,
} from "../core/manifest.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ScanInput {
  commits: GitCommit[];
  files: string[];
  dependencies: { name: string; source: string }[];
  configFiles: { path: string; content: string }[];
}

export function buildEvidence(input: ScanInput): Evidence[] {
  const evidence: Evidence[] = [];

  for (const commit of input.commits) {
    evidence.push(createCommitEvidence(commit));
  }

  for (const filePath of input.files) {
    if (!isSensitivePath(filePath)) {
      evidence.push(
        createFileEvidence(filePath, filePath, 1.0)
      );
    }
  }

  for (const dep of input.dependencies) {
    evidence.push(createDependencyEvidence(dep.name, dep.source));
  }

  for (const cfg of input.configFiles) {
    evidence.push(createConfigEvidence(cfg.path, cfg.content));
  }

  return evidence;
}

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

  const evidence = buildEvidence({
    commits,
    files: trackedFiles,
    dependencies,
    configFiles,
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

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern scan`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/commands/scan.ts packages/skillproof-cli/src/commands/scan.test.ts
git commit -m "feat: add scan command with evidence extraction pipeline"
```

---

### Task 10: Infer Command (Static Phase)

**Files:**
- Create: `packages/skillproof-cli/src/commands/infer.ts`
- Create: `packages/skillproof-cli/src/commands/infer.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeManifest, readManifest, createEmptyManifest } from "../core/manifest.js";
import { runInferStatic } from "./infer.js";

describe("infer", () => {
  let tempDir: string;
  let manifestPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-test-"));
    manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("infers skills from evidence in manifest and writes them back", async () => {
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });
    manifest.evidence = [
      {
        id: "EV-CONFIG-abc",
        type: "config",
        hash: "abc",
        timestamp: "2025-01-01T00:00:00Z",
        ownership: 1.0,
        source: "Dockerfile",
      },
      {
        id: "EV-DEP-redis",
        type: "dependency",
        hash: "def",
        timestamp: "2025-01-01T00:00:00Z",
        ownership: 1.0,
        source: "package.json",
      },
    ];
    await writeManifest(manifestPath, manifest);

    await runInferStatic(manifestPath);

    const updated = await readManifest(manifestPath);
    assert.ok(updated.skills.length >= 2);
    assert.ok(updated.skills.some((s) => s.name === "Docker"));
    assert.ok(updated.skills.some((s) => s.name === "Redis"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern infer`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import { readManifest, writeManifest, getManifestPath } from "../core/manifest.js";
import { inferStaticSkills } from "../core/skills.js";
import type { Claim } from "../types/manifest.js";

export async function runInferStatic(manifestPath: string): Promise<void> {
  const manifest = await readManifest(manifestPath);
  const skills = inferStaticSkills(manifest.evidence);

  manifest.skills = skills;
  manifest.claims = skills.map((s, i) => {
    const category = inferCategory(s.name);
    return {
      id: `CLAIM-${i + 1}`,
      category,
      skill: s.name,
      confidence: s.confidence,
      evidence_ids: s.evidence_ids,
    } satisfies Claim;
  });

  await writeManifest(manifestPath, manifest);
  console.log(`Inferred ${skills.length} skills from static signals.`);
}

function inferCategory(skillName: string): Claim["category"] {
  const languages = ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Java"];
  const frameworks = ["React", "Next.js", "Express", "FastAPI", "Vue", "Angular"];
  const infra = ["Docker", "Kubernetes", "Terraform", "AWS", "GCP", "Azure"];
  const tools = ["Redis", "PostgreSQL", "MongoDB", "GraphQL", "GitHub Actions"];

  if (languages.includes(skillName)) return "language";
  if (frameworks.includes(skillName)) return "framework";
  if (infra.includes(skillName)) return "infrastructure";
  if (tools.includes(skillName)) return "tool";
  return "practice";
}

export async function runInfer(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  await runInferStatic(manifestPath);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern infer`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/commands/infer.ts packages/skillproof-cli/src/commands/infer.test.ts
git commit -m "feat: add infer command with static skill inference and claim generation"
```

---

### Task 11: Render Command

**Files:**
- Create: `packages/skillproof-cli/src/commands/render.ts`
- Create: `packages/skillproof-cli/src/commands/render.test.ts`
- Create: `skills/resume/templates/resume.modern.md`

**Step 1: Write the resume template**

File: `skills/resume/templates/resume.modern.md`

```markdown
# {{authorName}}

> Verifiable Developer Resume — generated {{generatedAt}}

## Skills

{{#skills}}
### {{name}}
- **Confidence:** {{confidence}}
- **Evidence:** {{evidenceIds}}
- **Inferred by:** {{inferredBy}}

{{/skills}}

## Evidence Summary

- **Total evidence items:** {{evidenceCount}}
- **Commits analyzed:** {{commitCount}}
- **Dependencies detected:** {{dependencyCount}}
- **Config files scanned:** {{configCount}}

---

*This resume was generated by [SkillProof](https://github.com/skillproof) and can be cryptographically verified.*
*Repo: {{repoUrl}} @ {{headCommit}}*
```

**Step 2: Write the failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderResume } from "./render.js";
import type { Manifest } from "../types/manifest.js";

describe("render", () => {
  it("generates markdown with skills sorted by confidence", () => {
    const manifest: Manifest = {
      schema_version: "1.0",
      generated_at: "2025-01-01T00:00:00Z",
      repo: { url: "https://github.com/test/repo", head_commit: "abc123" },
      author: { name: "John Doe", email: "john@example.com" },
      evidence: [
        { id: "EV-DEP-redis", type: "dependency", hash: "a", timestamp: "2025-01-01T00:00:00Z", ownership: 1.0, source: "package.json" },
        { id: "EV-COMMIT-abc", type: "commit", hash: "b", timestamp: "2025-01-01T00:00:00Z", ownership: 1.0, source: "abc" },
      ],
      skills: [
        { name: "Redis", confidence: 0.82, evidence_ids: ["EV-DEP-redis"], inferred_by: "static" },
        { name: "TypeScript", confidence: 0.90, evidence_ids: ["EV-COMMIT-abc"], inferred_by: "static" },
      ],
      claims: [],
      signatures: [],
    };

    const md = renderResume(manifest);
    assert.ok(md.includes("John Doe"));
    assert.ok(md.includes("Redis"));
    assert.ok(md.includes("TypeScript"));
    // TypeScript (0.90) should appear before Redis (0.82)
    const tsIndex = md.indexOf("TypeScript");
    const redisIndex = md.indexOf("Redis");
    assert.ok(tsIndex < redisIndex, "Skills should be sorted by confidence desc");
  });

  it("includes evidence count summary", () => {
    const manifest: Manifest = {
      schema_version: "1.0",
      generated_at: "2025-01-01T00:00:00Z",
      repo: { url: null, head_commit: "abc" },
      author: { name: "Jane", email: "jane@ex.com" },
      evidence: [],
      skills: [],
      claims: [],
      signatures: [],
    };
    const md = renderResume(manifest);
    assert.ok(md.includes("Jane"));
    assert.ok(md.includes("0")); // zero evidence
  });
});
```

**Step 3: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern render`
Expected: FAIL

**Step 4: Write minimal implementation**

```typescript
import type { Manifest } from "../types/manifest.js";
import { readManifest, getManifestPath } from "../core/manifest.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export function renderResume(manifest: Manifest): string {
  const skills = [...manifest.skills].sort((a, b) => b.confidence - a.confidence);
  const commitCount = manifest.evidence.filter((e) => e.type === "commit").length;
  const depCount = manifest.evidence.filter((e) => e.type === "dependency").length;
  const configCount = manifest.evidence.filter((e) => e.type === "config").length;

  let md = `# ${manifest.author.name}\n\n`;
  md += `> Verifiable Developer Resume — generated ${manifest.generated_at}\n\n`;
  md += `## Skills\n\n`;

  for (const skill of skills) {
    md += `### ${skill.name}\n`;
    md += `- **Confidence:** ${skill.confidence}\n`;
    md += `- **Evidence:** ${skill.evidence_ids.join(" ")}\n`;
    md += `- **Inferred by:** ${skill.inferred_by}\n\n`;
  }

  md += `## Evidence Summary\n\n`;
  md += `- **Total evidence items:** ${manifest.evidence.length}\n`;
  md += `- **Commits analyzed:** ${commitCount}\n`;
  md += `- **Dependencies detected:** ${depCount}\n`;
  md += `- **Config files scanned:** ${configCount}\n\n`;
  md += `---\n\n`;
  md += `*This resume was generated by SkillProof and can be cryptographically verified.*\n`;
  md += `*Repo: ${manifest.repo.url || "local"} @ ${manifest.repo.head_commit}*\n`;

  return md;
}

export async function runRender(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const manifest = await readManifest(manifestPath);
  const md = renderResume(manifest);
  const outputPath = path.join(cwd, "resume.md");
  await writeFile(outputPath, md, "utf8");
  console.log(`Resume written to ${outputPath}`);
}
```

**Step 5: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern render`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add packages/skillproof-cli/src/commands/render.ts packages/skillproof-cli/src/commands/render.test.ts skills/resume/templates/resume.modern.md
git commit -m "feat: add render command with resume markdown generation"
```

---

### Task 12: Sign Command

**Files:**
- Create: `packages/skillproof-cli/src/commands/sign.ts`
- Create: `packages/skillproof-cli/src/commands/sign.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPair, signManifest, verifySignature } from "./sign.js";

describe("sign", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("generateKeyPair", () => {
    it("generates Ed25519 key pair files", async () => {
      const keys = await generateKeyPair(tempDir);
      assert.ok(keys.publicKey.length > 0);
      assert.ok(keys.privateKey.length > 0);
    });
  });

  describe("signManifest / verifySignature", () => {
    it("signs a manifest and verifies the signature", async () => {
      const keys = await generateKeyPair(tempDir);
      const manifestContent = '{"schema_version":"1.0","evidence":[]}';

      const signature = signManifest(manifestContent, keys.privateKey);
      assert.ok(signature.length > 0);

      const valid = verifySignature(manifestContent, signature, keys.publicKey);
      assert.equal(valid, true);
    });

    it("rejects tampered content", async () => {
      const keys = await generateKeyPair(tempDir);
      const manifestContent = '{"schema_version":"1.0","evidence":[]}';
      const signature = signManifest(manifestContent, keys.privateKey);

      const valid = verifySignature("tampered content", signature, keys.publicKey);
      assert.equal(valid, false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern sign`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import crypto from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { readManifest, writeManifest, getManifestPath } from "../core/manifest.js";
import { canonicalJson } from "../core/hashing.js";
import type { Signature } from "../types/manifest.js";

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export async function generateKeyPair(keysDir: string): Promise<KeyPair> {
  await mkdir(keysDir, { recursive: true });

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const pubPath = path.join(keysDir, "candidate.pub");
  const privPath = path.join(keysDir, "candidate.key");

  await writeFile(pubPath, publicKey, "utf8");
  await writeFile(privPath, privateKey, { mode: 0o600, encoding: "utf8" } as any);

  return { publicKey, privateKey };
}

export function signManifest(content: string, privateKeyPem: string): string {
  const sign = crypto.createSign("SHA256");
  sign.update(content);
  sign.end();
  return sign.sign(privateKeyPem, "base64");
}

export function verifySignature(
  content: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  const verify = crypto.createVerify("SHA256");
  verify.update(content);
  verify.end();
  return verify.verify(publicKeyPem, signatureBase64, "base64");
}

async function loadOrGenerateKeys(cwd: string): Promise<KeyPair> {
  const keysDir = path.join(cwd, ".skillproof", "keys");
  const pubPath = path.join(keysDir, "candidate.pub");
  const privPath = path.join(keysDir, "candidate.key");

  try {
    const publicKey = await readFile(pubPath, "utf8");
    const privateKey = await readFile(privPath, "utf8");
    return { publicKey, privateKey };
  } catch {
    console.log("No existing keys found. Generating new Ed25519 key pair...");
    return generateKeyPair(keysDir);
  }
}

export async function runSign(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const manifest = await readManifest(manifestPath);

  // Remove existing signatures before signing
  manifest.signatures = [];
  const content = canonicalJson(manifest);

  const keys = await loadOrGenerateKeys(cwd);
  const sig = signManifest(content, keys.privateKey);

  const signature: Signature = {
    signer: "candidate",
    public_key: Buffer.from(keys.publicKey).toString("base64"),
    signature: sig,
    timestamp: new Date().toISOString(),
    algorithm: "Ed25519",
  };

  manifest.signatures = [signature];
  await writeManifest(manifestPath, manifest);
  console.log("Manifest signed successfully.");
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern sign`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/commands/sign.ts packages/skillproof-cli/src/commands/sign.test.ts
git commit -m "feat: add sign command with Ed25519 key generation and manifest signing"
```

---

### Task 13: Pack Command

**Files:**
- Create: `packages/skillproof-cli/src/commands/pack.ts`
- Create: `packages/skillproof-cli/src/commands/pack.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPack } from "./pack.js";
import { createEmptyManifest, writeManifest } from "../core/manifest.js";

describe("pack", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("creates a bundle.zip file", async () => {
    // Setup: manifest + resume.md
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });
    manifest.signatures = [{
      signer: "candidate",
      public_key: "dGVzdA==",
      signature: "c2lnbmF0dXJl",
      timestamp: "2025-01-01T00:00:00Z",
      algorithm: "Ed25519",
    }];

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);
    await writeFile(path.join(tempDir, "resume.md"), "# Test Resume\n", "utf8");

    await runPack(tempDir);

    const files = await readdir(tempDir);
    assert.ok(files.includes("bundle.zip"), "bundle.zip should exist");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern pack`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { getManifestPath } from "../core/manifest.js";

export async function runPack(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const resumePath = path.join(cwd, "resume.md");
  const bundlePath = path.join(cwd, "bundle.zip");

  // Verify required files exist
  await access(manifestPath);
  await access(resumePath);

  const manifestContent = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestContent);

  // Build verification.json
  const verification = {
    instructions: "To verify this resume bundle, use: skillproof verify bundle.zip",
    manifest_hash: (await import("../core/hashing.js")).hashContent(manifestContent),
    signature_count: manifest.signatures?.length || 0,
    generated_at: manifest.generated_at,
  };

  return new Promise((resolve, reject) => {
    const output = createWriteStream(bundlePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`Bundle created: ${bundlePath} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on("error", reject);
    archive.pipe(output);

    archive.file(resumePath, { name: "resume.md" });
    archive.file(manifestPath, { name: "resume-manifest.json" });
    archive.append(JSON.stringify(verification, null, 2), { name: "verification.json" });

    // Add signatures directory
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

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern pack`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/commands/pack.ts packages/skillproof-cli/src/commands/pack.test.ts
git commit -m "feat: add pack command to create distributable resume bundle"
```

---

### Task 14: Verify Command

**Files:**
- Create: `packages/skillproof-cli/src/commands/verify.ts`
- Create: `packages/skillproof-cli/src/commands/verify.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyBundle } from "./verify.js";
import { createEmptyManifest, writeManifest } from "../core/manifest.js";
import { generateKeyPair, signManifest } from "./sign.js";
import { canonicalJson } from "../core/hashing.js";
import { runPack } from "./pack.js";

describe("verify", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("verifies a valid bundle", async () => {
    // Create a signed manifest + resume + pack it
    const manifest = createEmptyManifest({
      repoUrl: null,
      headCommit: "abc",
      authorName: "Test",
      authorEmail: "test@example.com",
    });

    const keysDir = path.join(tempDir, ".skillproof", "keys");
    const keys = await generateKeyPair(keysDir);

    const content = canonicalJson(manifest);
    const sig = signManifest(content, keys.privateKey);
    manifest.signatures = [{
      signer: "candidate",
      public_key: Buffer.from(keys.publicKey).toString("base64"),
      signature: sig,
      timestamp: new Date().toISOString(),
      algorithm: "Ed25519",
    }];

    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await writeManifest(manifestPath, manifest);
    await writeFile(path.join(tempDir, "resume.md"), "# Test\n", "utf8");

    await runPack(tempDir);

    const bundlePath = path.join(tempDir, "bundle.zip");
    const result = await verifyBundle(bundlePath);
    assert.equal(result.valid, true);
    assert.equal(result.signatures.length, 1);
    assert.equal(result.signatures[0].valid, true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern verify`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canonicalJson } from "../core/hashing.js";
import { verifySignature } from "./sign.js";
import type { Manifest, Signature } from "../types/manifest.js";

const execFileAsync = promisify(execFile);

export interface VerifyResult {
  valid: boolean;
  signatures: { signer: string; valid: boolean; error?: string }[];
  manifestHash: string;
}

export async function verifyBundle(bundlePath: string): Promise<VerifyResult> {
  const extractDir = await mkdtemp(path.join(tmpdir(), "skillproof-verify-"));

  try {
    await execFileAsync("unzip", ["-o", bundlePath, "-d", extractDir]);

    const manifestContent = await readFile(
      path.join(extractDir, "resume-manifest.json"),
      "utf8"
    );
    const manifest: Manifest = JSON.parse(manifestContent);

    // Reconstruct the canonical manifest without signatures
    const manifestForVerify = { ...manifest, signatures: [] as Signature[] };
    const canonicalContent = canonicalJson(manifestForVerify);
    const { hashContent } = await import("../core/hashing.js");
    const manifestHash = hashContent(canonicalContent);

    const sigResults = manifest.signatures.map((sig) => {
      try {
        const publicKeyPem = Buffer.from(sig.public_key, "base64").toString("utf8");
        const valid = verifySignature(canonicalContent, sig.signature, publicKeyPem);
        return { signer: sig.signer, valid };
      } catch (err) {
        return { signer: sig.signer, valid: false, error: String(err) };
      }
    });

    const allValid = sigResults.length > 0 && sigResults.every((s) => s.valid);

    return {
      valid: allValid,
      signatures: sigResults,
      manifestHash,
    };
  } finally {
    await rm(extractDir, { recursive: true });
  }
}

export async function runVerify(bundlePath: string): Promise<void> {
  const result = await verifyBundle(bundlePath);

  console.log(`\nVerification Report`);
  console.log(`${"=".repeat(40)}`);
  console.log(`Manifest hash: ${result.manifestHash}`);
  console.log(`Overall: ${result.valid ? "VALID" : "INVALID"}`);
  console.log(`\nSignatures:`);

  for (const sig of result.signatures) {
    const status = sig.valid ? "PASS" : "FAIL";
    console.log(`  ${sig.signer}: ${status}${sig.error ? ` (${sig.error})` : ""}`);
  }

  if (!result.valid) {
    process.exitCode = 1;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern verify`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/commands/verify.ts packages/skillproof-cli/src/commands/verify.test.ts
git commit -m "feat: add verify command for bundle signature verification"
```

---

### Task 15: CLI Entry Point

**Files:**
- Modify: `packages/skillproof-cli/src/index.ts`

**Step 1: Write the CLI entry point**

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import { runScan } from "./commands/scan.js";
import { runInfer } from "./commands/infer.js";
import { runRender } from "./commands/render.js";
import { runSign } from "./commands/sign.js";
import { runPack } from "./commands/pack.js";
import { runVerify } from "./commands/verify.js";

const program = new Command();

program
  .name("skillproof")
  .description("Generate verifiable developer resumes from source code")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan repository and generate evidence graph")
  .action(async () => {
    await runScan(process.cwd());
  });

program
  .command("infer-skills")
  .description("Infer skills from evidence using static signals")
  .action(async () => {
    await runInfer(process.cwd());
  });

program
  .command("render")
  .description("Generate resume markdown from manifest")
  .action(async () => {
    await runRender(process.cwd());
  });

program
  .command("sign")
  .description("Sign resume manifest with Ed25519 key")
  .action(async () => {
    await runSign(process.cwd());
  });

program
  .command("pack")
  .description("Create distributable resume bundle")
  .action(async () => {
    await runPack(process.cwd());
  });

program
  .command("verify")
  .description("Verify resume bundle authenticity")
  .argument("<bundle>", "Path to bundle.zip")
  .action(async (bundle: string) => {
    await runVerify(bundle);
  });

program.parse();
```

**Step 2: Build and verify**

Run: `cd packages/skillproof-cli && npx tsc && node dist/index.js --help`
Expected: Shows help with all 6 commands listed

**Step 3: Commit**

```bash
git add packages/skillproof-cli/src/index.ts
git commit -m "feat: add CLI entry point with all commands wired up"
```

---

### Task 16: Claude Plugin Definition

**Files:**
- Create: `.claude-plugin/plugin.json`

**Step 1: Write plugin.json**

```json
{
  "name": "skillproof",
  "description": "Generate verifiable developer resumes from source code",
  "version": "0.1.0",
  "author": {
    "name": "Michael Chen"
  },
  "license": "MIT",
  "keywords": [
    "resume",
    "skills",
    "provenance",
    "attestation"
  ]
}
```

**Step 2: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: add Claude plugin definition"
```

---

### Task 17: Slash Commands

**Files:**
- Create: `commands/skillproof-scan.md`
- Create: `commands/skillproof-infer.md`
- Create: `commands/skillproof-render.md`
- Create: `commands/skillproof-sign.md`
- Create: `commands/skillproof-pack.md`
- Create: `commands/skillproof-verify.md`
- Create: `commands/skillproof-all.md`

**Step 1: Write all command files**

`commands/skillproof-scan.md`:
```
description: Scan repository and generate evidence graph
disable-model-invocation: true

Invoke the skillproof:resume skill and follow the "resume-scan" procedure exactly as presented to you
```

`commands/skillproof-infer.md`:
```
description: Infer skills from evidence
disable-model-invocation: false

Invoke the skillproof:resume skill and follow the "resume-infer" procedure exactly as presented to you
```

`commands/skillproof-render.md`:
```
description: Generate resume markdown
disable-model-invocation: true

Invoke the skillproof:resume skill and follow the "resume-render" procedure exactly as presented to you
```

`commands/skillproof-sign.md`:
```
description: Sign resume manifest
disable-model-invocation: true

Invoke the skillproof:resume skill and follow the "resume-sign" procedure exactly as presented to you
```

`commands/skillproof-pack.md`:
```
description: Create distributable resume bundle
disable-model-invocation: true

Invoke the skillproof:resume skill and follow the "resume-pack" procedure exactly as presented to you
```

`commands/skillproof-verify.md`:
```
description: Verify resume bundle authenticity
disable-model-invocation: true

Invoke the skillproof:resume skill and follow the "resume-verify" procedure exactly as presented to you
```

`commands/skillproof-all.md`:
```
description: Run the entire resume generation pipeline
disable-model-invocation: false

Invoke the skillproof:resume skill and follow the "resume-all" procedure exactly as presented to you
```

**Step 2: Commit**

```bash
git add commands/
git commit -m "feat: add Claude slash commands for all resume operations"
```

---

### Task 18: Skill Definition (SKILL.md)

**Files:**
- Create: `skills/resume/SKILL.md`

**Step 1: Write the skill definition**

This is the core skill that orchestrates all procedures. It should define each procedure referenced by the slash commands.

```markdown
name: resume
description: Generate verifiable developer resumes from source code repositories

---

## Procedures

### resume-scan

1. Ensure the CLI is built:
   ```bash
   cd packages/skillproof-cli && npm run build
   ```
2. Run the scan command:
   ```bash
   cd <repo-root> && node packages/skillproof-cli/dist/index.js scan
   ```
3. Report the results to the user: how many evidence items were found, broken down by type.

### resume-infer

1. Ensure the CLI is built.
2. Run static inference:
   ```bash
   cd <repo-root> && node packages/skillproof-cli/dist/index.js infer-skills
   ```
3. Read the manifest at `.skillproof/skillproof-manifest.json`.
4. Analyze the evidence and skills already inferred. Use your reasoning to identify additional skills not caught by static signals:
   - Look at architecture patterns (microservices, monolith, event-driven)
   - Look at testing practices (TDD, integration tests, e2e)
   - Look at code quality practices (linting, formatting, CI/CD)
   - Assign confidence scores (0.0-1.0) based on strength of evidence
5. Update the manifest with any additional LLM-inferred skills (set `inferred_by: "llm"`).
6. Write the updated manifest back to `.skillproof/skillproof-manifest.json`.
7. Report all skills found to the user.

### resume-render

1. Ensure the CLI is built.
2. Run the render command:
   ```bash
   cd <repo-root> && node packages/skillproof-cli/dist/index.js render
   ```
3. Show the user a preview of the generated resume.md.

### resume-sign

1. Ensure the CLI is built.
2. Run the sign command:
   ```bash
   cd <repo-root> && node packages/skillproof-cli/dist/index.js sign
   ```
3. Confirm to the user that the manifest has been signed.

### resume-pack

1. Ensure the CLI is built.
2. Run the pack command:
   ```bash
   cd <repo-root> && node packages/skillproof-cli/dist/index.js pack
   ```
3. Confirm the bundle.zip was created and list its contents.

### resume-verify

1. Ensure the CLI is built.
2. Run the verify command:
   ```bash
   cd <repo-root> && node packages/skillproof-cli/dist/index.js verify bundle.zip
   ```
3. Report the verification results to the user.

### resume-all

Run all procedures in sequence:

1. resume-scan
2. resume-infer
3. resume-render
4. resume-sign
5. resume-pack
6. resume-verify

Report a summary after each step. If any step fails, stop and report the error.
```

**Step 2: Commit**

```bash
git add skills/resume/SKILL.md
git commit -m "feat: add resume skill with all procedures for slash commands"
```

---

### Task 19: Git Ignore & Final Wiring

**Files:**
- Create: `.gitignore`

**Step 1: Write .gitignore**

```
node_modules/
dist/
*.js.map
bundle.zip
resume.md
.skillproof/keys/
```

**Step 2: Initialize git repo and make initial commit**

Run: `cd /Users/sin-chengchen/office-project/skillproof && git init`

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```

---

### Task 20: Integration Test

**Files:**
- Create: `packages/skillproof-cli/src/commands/integration.test.ts`

**Step 1: Write integration test**

This test requires a real git repo. It creates a temp directory, initializes git, makes a commit, then runs the full pipeline.

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runScan } from "./scan.js";
import { runInferStatic } from "./infer.js";
import { runRender } from "./render.js";
import { runSign } from "./sign.js";
import { runPack } from "./pack.js";
import { verifyBundle } from "./verify.js";

const execFileAsync = promisify(execFile);

describe("integration: full pipeline", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-integration-"));

    // Init git repo
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });

    // Create a package.json with dependencies
    await writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.0.0", redis: "^4.0.0" } }),
      "utf8"
    );

    // Create a TypeScript file
    await writeFile(path.join(tempDir, "index.ts"), "console.log('hello');", "utf8");

    // Create a Dockerfile
    await writeFile(path.join(tempDir, "Dockerfile"), "FROM node:20\nRUN npm install", "utf8");

    // Commit everything
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("runs scan -> infer -> render -> sign -> pack -> verify", async () => {
    // Scan
    await runScan(tempDir);
    const manifestPath = path.join(tempDir, ".skillproof", "resume-manifest.json");
    await access(manifestPath); // exists

    // Infer
    await runInferStatic(manifestPath);
    const manifest1 = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.ok(manifest1.skills.length > 0, "Should have inferred skills");

    // Render
    await runRender(tempDir);
    const resumePath = path.join(tempDir, "resume.md");
    const resume = await readFile(resumePath, "utf8");
    assert.ok(resume.includes("Test User"));

    // Sign
    await runSign(tempDir);
    const manifest2 = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest2.signatures.length, 1);

    // Pack
    await runPack(tempDir);
    const bundlePath = path.join(tempDir, "bundle.zip");
    await access(bundlePath);

    // Verify
    const result = await verifyBundle(bundlePath);
    assert.equal(result.valid, true);
  });
});
```

**Step 2: Run integration test**

Run: `cd packages/skillproof-cli && npm test -- --test-name-pattern integration`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add packages/skillproof-cli/src/commands/integration.test.ts
git commit -m "test: add full pipeline integration test"
```

---

## Task Summary

| Task | Component | Description |
|------|-----------|-------------|
| 1 | Scaffolding | package.json, tsconfig.json, npm install |
| 2 | Types | Manifest, Evidence, Skill, Claim, Signature interfaces |
| 3 | Core | Hashing module (SHA-256, canonical JSON) |
| 4 | Core | Security module (sensitive path/content detection) |
| 5 | Core | Git module (log parsing, repo queries) |
| 6 | Core | Evidence module (factory functions) |
| 7 | Core | Manifest module (create, read, write) |
| 8 | Core | Skills module (static signal inference) |
| 9 | Command | Scan (evidence extraction pipeline) |
| 10 | Command | Infer (static skill inference) |
| 11 | Command | Render (resume markdown generation) |
| 12 | Command | Sign (Ed25519 signing) |
| 13 | Command | Pack (bundle.zip creation) |
| 14 | Command | Verify (bundle verification) |
| 15 | CLI | Entry point with commander.js |
| 16 | Plugin | .claude-plugin/plugin.json |
| 17 | Plugin | All 7 slash commands |
| 18 | Plugin | SKILL.md with all procedures |
| 19 | Config | .gitignore + git init |
| 20 | Test | Full pipeline integration test |
