# CLI LLM-Powered Locale-Aware Render — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Claude API integration to the CLI `render` command so it generates locale-aware resumes via LLM when a locale is specified.

**Architecture:** Four new core modules (config, prompt, verification, llm) plus modifications to the render command and CLI entry point. When locale is provided, the render command follows the LLM path; without locale, existing English template behavior is unchanged.

**Tech Stack:** TypeScript, Node.js, `@anthropic-ai/sdk`, `commander`, Node built-in `readline`

---

### Task 1: Add `@anthropic-ai/sdk` dependency

**Files:**
- Modify: `packages/skillproof-cli/package.json`

**Step 1: Install the SDK**

```bash
cd packages/skillproof-cli && npm install @anthropic-ai/sdk
```

**Step 2: Verify installation**

```bash
node -e "import('@anthropic-ai/sdk').then(() => console.log('OK'))"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add packages/skillproof-cli/package.json packages/skillproof-cli/package-lock.json
git commit -m "chore: add @anthropic-ai/sdk dependency"
```

---

### Task 2: Create `core/config.ts` — API key management

**Files:**
- Create: `packages/skillproof-cli/src/core/config.ts`
- Create: `packages/skillproof-cli/src/core/config.test.ts`

**Step 1: Write the failing tests**

Create `packages/skillproof-cli/src/core/config.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveApiKey, readConfig, writeConfig } from "./config.ts";

describe("config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `skillproof-test-${Date.now()}`);
    await mkdir(path.join(tmpDir, ".skillproof"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("readConfig", () => {
    it("returns empty object when config does not exist", async () => {
      const config = await readConfig(tmpDir);
      assert.deepEqual(config, {});
    });

    it("reads existing config", async () => {
      const configPath = path.join(tmpDir, ".skillproof", "config.json");
      await writeFile(configPath, JSON.stringify({ anthropic_api_key: "sk-test" }));
      const config = await readConfig(tmpDir);
      assert.equal(config.anthropic_api_key, "sk-test");
    });
  });

  describe("writeConfig", () => {
    it("writes config to file", async () => {
      await writeConfig(tmpDir, { anthropic_api_key: "sk-new" });
      const configPath = path.join(tmpDir, ".skillproof", "config.json");
      const content = JSON.parse(await readFile(configPath, "utf8"));
      assert.equal(content.anthropic_api_key, "sk-new");
    });
  });

  describe("resolveApiKey", () => {
    it("returns env var when set", async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "sk-env";
      try {
        const key = await resolveApiKey(tmpDir);
        assert.equal(key, "sk-env");
      } finally {
        if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it("falls back to config file", async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        await writeConfig(tmpDir, { anthropic_api_key: "sk-config" });
        const key = await resolveApiKey(tmpDir);
        assert.equal(key, "sk-config");
      } finally {
        if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it("returns null when neither env nor config has key", async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const key = await resolveApiKey(tmpDir);
        assert.equal(key, null);
      } finally {
        if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
      }
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skillproof-cli && npm test 2>&1 | grep -E "(config|FAIL|PASS|Error)"
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/skillproof-cli/src/core/config.ts`:

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface SkillProofConfig {
  anthropic_api_key?: string;
}

function getConfigPath(cwd: string): string {
  return path.join(cwd, ".skillproof", "config.json");
}

export async function readConfig(cwd: string): Promise<SkillProofConfig> {
  try {
    const content = await readFile(getConfigPath(cwd), "utf8");
    return JSON.parse(content) as SkillProofConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(cwd: string, config: SkillProofConfig): Promise<void> {
  const configPath = getConfigPath(cwd);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export async function resolveApiKey(cwd: string): Promise<string | null> {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  const config = await readConfig(cwd);
  if (config.anthropic_api_key) return config.anthropic_api_key;

  return null;
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/skillproof-cli && npm test 2>&1 | grep -E "(config|FAIL|PASS)"
```

Expected: All config tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/core/config.ts packages/skillproof-cli/src/core/config.test.ts
git commit -m "feat(config): add API key management with env var and config file support"
```

---

### Task 3: Create `core/prompt.ts` — interactive stdin helper

**Files:**
- Create: `packages/skillproof-cli/src/core/prompt.ts`

**Step 1: Write implementation** (no unit tests — thin readline wrapper)

Create `packages/skillproof-cli/src/core/prompt.ts`:

```typescript
import readline from "node:readline";

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function askYesNo(question: string): Promise<boolean> {
  const answer = await ask(`${question} (y/n): `);
  return answer.toLowerCase().startsWith("y");
}
```

**Step 2: Commit**

```bash
git add packages/skillproof-cli/src/core/prompt.ts
git commit -m "feat(prompt): add interactive stdin helper for CLI prompts"
```

---

### Task 4: Create `core/verification.ts` — verification block assembly

**Files:**
- Create: `packages/skillproof-cli/src/core/verification.ts`
- Create: `packages/skillproof-cli/src/core/verification.test.ts`

**Step 1: Write the failing tests**

Create `packages/skillproof-cli/src/core/verification.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildVerificationBlock } from "./verification.ts";
import type { Manifest } from "../types/manifest.ts";

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schema_version: "1.0",
    generated_at: "2026-01-01T00:00:00Z",
    repo: { url: "https://github.com/test/repo", head_commit: "abcdef1234567890" },
    author: { name: "Test", email: "test@test.com" },
    evidence: [
      { id: "EV-1", type: "commit", hash: "a", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "abc" },
      { id: "EV-2", type: "file", hash: "b", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "test.ts" },
    ],
    skills: [
      { name: "TypeScript", confidence: 1, evidence_ids: ["EV-2"], inferred_by: "static" },
    ],
    claims: [],
    signatures: [],
    ...overrides,
  };
}

describe("verification", () => {
  it("builds block with signature data when signed", () => {
    const manifest = makeManifest({
      signatures: [{
        signer: "candidate",
        public_key: "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0K",
        signature: "abc123==",
        timestamp: "2026-01-01T12:00:00Z",
        algorithm: "Ed25519",
      }],
    });

    const block = buildVerificationBlock(manifest);

    assert.ok(block.includes("## SkillProof Verification"));
    assert.ok(block.includes("**Evidence items:** 2"));
    assert.ok(block.includes("**Skills verified:** 1"));
    assert.ok(block.includes("**Repository:** https://github.com/test/repo"));
    assert.ok(block.includes("**Commit:** abcdef1"));
    assert.ok(block.includes("**Signature algorithm:** Ed25519"));
    assert.ok(block.includes("**Signer:** candidate"));
    assert.ok(block.includes("**Public key fingerprint:** LS0tLS1CRUdJTiBQ"));
    assert.ok(block.includes("VALID"));
    assert.ok(block.includes("<details>"));
  });

  it("shows unsigned warning when no signatures", () => {
    const manifest = makeManifest({ signatures: [] });
    const block = buildVerificationBlock(manifest);

    assert.ok(block.includes("## SkillProof Verification"));
    assert.ok(block.includes("**Evidence items:** 2"));
    assert.ok(!block.includes("<details>"));
    assert.ok(block.includes("Unsigned"));
  });

  it("uses 'local' when repo url is null", () => {
    const manifest = makeManifest({ repo: { url: null, head_commit: "abc1234" } });
    const block = buildVerificationBlock(manifest);
    assert.ok(block.includes("**Repository:** local"));
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skillproof-cli && npm test 2>&1 | grep -E "(verification|FAIL|PASS|Error)"
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/skillproof-cli/src/core/verification.ts`:

```typescript
import type { Manifest } from "../types/manifest.ts";
import { canonicalJson, hashContent } from "./hashing.ts";

export function buildVerificationBlock(manifest: Manifest): string {
  const commitShort = manifest.repo.head_commit.slice(0, 7);
  const repoUrl = manifest.repo.url || "local";

  let block = `\n---\n\n## SkillProof Verification\n\n`;
  block += `This resume is backed by cryptographic evidence from source code analysis.\n\n`;
  block += `- **Evidence items:** ${manifest.evidence.length}\n`;
  block += `- **Skills verified:** ${manifest.skills.length}\n`;
  block += `- **Repository:** ${repoUrl}\n`;
  block += `- **Commit:** ${commitShort}\n`;
  block += `- **Generated:** ${manifest.generated_at}\n`;

  if (manifest.signatures.length === 0) {
    block += `\n> ⚠️ Unsigned — run \`skillproof sign\` first to add cryptographic proof.\n`;
    return block;
  }

  const sig = manifest.signatures[0];
  const manifestForHash = { ...manifest, signatures: [] };
  const manifestHash = hashContent(canonicalJson(manifestForHash));
  const fingerprint = sig.public_key.slice(0, 16);

  block += `\n<details>\n<summary>Technical Verification Details</summary>\n\n`;
  block += `- **Manifest hash:** ${manifestHash}\n`;
  block += `- **Signature algorithm:** ${sig.algorithm}\n`;
  block += `- **Signer:** ${sig.signer}\n`;
  block += `- **Public key fingerprint:** ${fingerprint}\n`;
  block += `- **Signed at:** ${sig.timestamp}\n`;
  block += `- **Verification status:** VALID\n\n`;
  block += `To verify: \`skillproof verify bundle.zip\`\n\n`;
  block += `</details>\n`;

  return block;
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/skillproof-cli && npm test 2>&1 | grep -E "(verification|FAIL|PASS)"
```

Expected: All verification tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/core/verification.ts packages/skillproof-cli/src/core/verification.test.ts
git commit -m "feat(verification): add SkillProof verification block builder"
```

---

### Task 5: Create `core/llm.ts` — Claude API wrapper

**Files:**
- Create: `packages/skillproof-cli/src/core/llm.ts`
- Create: `packages/skillproof-cli/src/core/llm.test.ts`

**Step 1: Write the failing tests**

Create `packages/skillproof-cli/src/core/llm.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPromptMessages } from "./llm.ts";
import type { Manifest } from "../types/manifest.ts";

const manifest: Manifest = {
  schema_version: "1.0",
  generated_at: "2026-01-01T00:00:00Z",
  repo: { url: "https://github.com/test/repo", head_commit: "abc1234" },
  author: { name: "Alice", email: "alice@test.com" },
  evidence: [
    { id: "EV-1", type: "commit", hash: "a", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "abc" },
    { id: "EV-2", type: "file", hash: "b", timestamp: "2026-01-01T00:00:00Z", ownership: 1, source: "f.ts" },
  ],
  skills: [
    { name: "TypeScript", confidence: 1, evidence_ids: ["EV-2"], inferred_by: "static" },
    { name: "Node.js", confidence: 0.8, evidence_ids: ["EV-1"], inferred_by: "llm" },
  ],
  claims: [],
  signatures: [],
};

describe("llm", () => {
  describe("buildPromptMessages", () => {
    it("includes author info in user message", () => {
      const { userMessage } = buildPromptMessages(manifest, "zh-TW", null);
      assert.ok(userMessage.includes("Alice"));
      assert.ok(userMessage.includes("alice@test.com"));
    });

    it("includes skills sorted by confidence", () => {
      const { userMessage } = buildPromptMessages(manifest, "zh-TW", null);
      const tsIdx = userMessage.indexOf("TypeScript");
      const nodeIdx = userMessage.indexOf("Node.js");
      assert.ok(tsIdx < nodeIdx, "TypeScript (1.0) should come before Node.js (0.8)");
    });

    it("includes evidence stats", () => {
      const { userMessage } = buildPromptMessages(manifest, "en-US", null);
      assert.ok(userMessage.includes("2")); // total evidence
      assert.ok(userMessage.includes("1")); // commits
    });

    it("includes locale in system message", () => {
      const { systemMessage } = buildPromptMessages(manifest, "ja", null);
      assert.ok(systemMessage.includes("ja"));
    });

    it("includes personal info when provided", () => {
      const { userMessage } = buildPromptMessages(manifest, "zh-TW", "5 years backend experience");
      assert.ok(userMessage.includes("5 years backend experience"));
    });

    it("indicates no personal info when null", () => {
      const { userMessage } = buildPromptMessages(manifest, "zh-TW", null);
      assert.ok(userMessage.includes("N/A") || userMessage.includes("None"));
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skillproof-cli && npm test 2>&1 | grep -E "(llm|FAIL|PASS|Error)"
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/skillproof-cli/src/core/llm.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { Manifest } from "../types/manifest.ts";

export interface PromptMessages {
  systemMessage: string;
  userMessage: string;
}

export function buildPromptMessages(
  manifest: Manifest,
  locale: string,
  personalInfo: string | null
): PromptMessages {
  const skills = [...manifest.skills].sort((a, b) => b.confidence - a.confidence);
  const commitCount = manifest.evidence.filter((e) => e.type === "commit").length;
  const fileCount = manifest.evidence.filter((e) => e.type === "file").length;

  const systemMessage = `You are a professional resume writer. Based on the verified skill data provided, write a professional resume in ${locale}.

Rules:
- Write in the target language, following that culture's resume conventions.
- Keep technical skill names in English (TypeScript, Node.js, etc.).
- Convert confidence scores to human-friendly descriptions in the target language:
  - 0.9–1.0: Expert level
  - 0.7–0.89: Proficient level
  - 0.5–0.69: Familiar level
  - Below 0.5: Beginner level
- Do NOT fabricate skills or experiences not present in the data.
- Do NOT include evidence IDs.
- If personal info is provided, integrate it naturally.
- Output pure Markdown only. No code fences around the output.`;

  const skillLines = skills
    .map((s) => `- ${s.name} (confidence: ${s.confidence}, evidence count: ${s.evidence_ids.length}, inferred by: ${s.inferred_by})`)
    .join("\n");

  const userMessage = `## Author
${manifest.author.name} | ${manifest.author.email}

## Verified Skills (sorted by confidence)
${skillLines}

## Evidence Statistics
- Total evidence items: ${manifest.evidence.length}
- Commits analyzed: ${commitCount}
- Files scanned: ${fileCount}

## Personal Info
${personalInfo || "None"}

Please generate the resume.`;

  return { systemMessage, userMessage };
}

export async function generateResume(
  apiKey: string,
  manifest: Manifest,
  locale: string,
  personalInfo: string | null
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const { systemMessage, userMessage } = buildPromptMessages(manifest, locale, personalInfo);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemMessage,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude API");
  }
  return textBlock.text;
}
```

**Step 4: Run tests to verify they pass**

```bash
cd packages/skillproof-cli && npm test 2>&1 | grep -E "(llm|FAIL|PASS)"
```

Expected: All llm tests PASS (only `buildPromptMessages` is tested; `generateResume` hits real API)

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/core/llm.ts packages/skillproof-cli/src/core/llm.test.ts
git commit -m "feat(llm): add Claude API wrapper with prompt builder for resume generation"
```

---

### Task 6: Modify `commands/render.ts` — add LLM render path

**Files:**
- Modify: `packages/skillproof-cli/src/commands/render.ts`

**Step 1: Write the new render command**

Replace the entire content of `packages/skillproof-cli/src/commands/render.ts` with:

```typescript
import type { Manifest } from "../types/manifest.ts";
import { readManifest, getManifestPath } from "../core/manifest.ts";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveApiKey, writeConfig, readConfig } from "../core/config.ts";
import { ask, askYesNo } from "../core/prompt.ts";
import { generateResume } from "../core/llm.ts";
import { buildVerificationBlock } from "../core/verification.ts";

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

async function resolveApiKeyInteractive(cwd: string): Promise<string> {
  let apiKey = await resolveApiKey(cwd);

  if (!apiKey) {
    console.log("No API key found.");
    apiKey = await ask("Enter your Anthropic API key: ");
    if (!apiKey) {
      throw new Error("API key is required for locale-aware rendering.");
    }
    const save = await askYesNo("Save to .skillproof/config.json for future use?");
    if (save) {
      const config = await readConfig(cwd);
      config.anthropic_api_key = apiKey;
      await writeConfig(cwd, config);
      console.log("Key saved.");
    }
  }

  return apiKey;
}

export async function runRender(cwd: string, locale?: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const manifest = await readManifest(manifestPath);

  if (!locale) {
    const md = renderResume(manifest);
    const outputPath = path.join(cwd, "resume.md");
    await writeFile(outputPath, md, "utf8");
    console.log(`Resume written to ${outputPath}`);
    return;
  }

  const apiKey = await resolveApiKeyInteractive(cwd);

  const personalInfoResponse = await ask(
    "Would you like to include a personal introduction or work experience?\n(Type your info, or 'skip' to continue): "
  );
  const personalInfo = personalInfoResponse.toLowerCase() === "skip" ? null : personalInfoResponse || null;

  console.log(`Generating resume in ${locale}...`);
  const resumeContent = await generateResume(apiKey, manifest, locale, personalInfo);
  const verificationBlock = buildVerificationBlock(manifest);
  const fullResume = resumeContent + verificationBlock;

  const outputPath = path.join(cwd, "resume.md");
  await writeFile(outputPath, fullResume, "utf8");
  console.log(`Resume written to ${outputPath}`);
}
```

**Step 2: Run existing render tests to verify they still pass**

```bash
cd packages/skillproof-cli && npm test 2>&1 | grep -E "(render|FAIL|PASS)"
```

Expected: Existing `renderResume` tests still PASS (the function signature is unchanged)

**Step 3: Commit**

```bash
git add packages/skillproof-cli/src/commands/render.ts
git commit -m "feat(render): add LLM path with locale support to render command"
```

---

### Task 7: Modify `src/index.ts` — wire up locale argument

**Files:**
- Modify: `packages/skillproof-cli/src/index.ts`

**Step 1: Update the render command registration**

In `packages/skillproof-cli/src/index.ts`, replace the render command block (lines 33-38):

```typescript
program
  .command("render")
  .description("Generate resume markdown from manifest")
  .action(async () => {
    await runRender(process.cwd());
  });
```

With:

```typescript
program
  .command("render")
  .description("Generate resume markdown from manifest")
  .argument("[locale]", "Target locale for LLM generation (e.g., zh-TW, ja, en-US)")
  .option("--locale <locale>", "Target locale (alternative to positional argument)")
  .action(async (localeArg: string | undefined, options: { locale?: string }) => {
    const locale = localeArg || options.locale;
    await runRender(process.cwd(), locale);
  });
```

**Step 2: Build and verify CLI help**

```bash
cd packages/skillproof-cli && npm run build && node dist/index.js render --help
```

Expected: Should show `[locale]` argument and `--locale` option in help output

**Step 3: Commit**

```bash
git add packages/skillproof-cli/src/index.ts
git commit -m "feat(cli): add locale argument and --locale option to render command"
```

---

### Task 8: Build and smoke test

**Step 1: Build the project**

```bash
cd packages/skillproof-cli && npm run build
```

Expected: No compilation errors

**Step 2: Run all tests**

```bash
cd packages/skillproof-cli && npm test
```

Expected: All tests pass

**Step 3: Test no-locale path (backward compatibility)**

```bash
node packages/skillproof-cli/dist/index.js render
```

Expected: English template output to `resume.md` (same as before)

**Step 4: Test locale path**

```bash
ANTHROPIC_API_KEY=your-key node packages/skillproof-cli/dist/index.js render zh-TW
```

Expected: Interactive prompt for personal info, then Chinese resume generated with verification block

**Step 5: Test --locale flag**

```bash
ANTHROPIC_API_KEY=your-key node packages/skillproof-cli/dist/index.js render --locale ja
```

Expected: Same flow but with Japanese output

**Step 6: Commit**

```bash
git add -A
git commit -m "test: verify CLI LLM render with locale support"
```
