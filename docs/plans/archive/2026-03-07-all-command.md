# `skillproof all` Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an `all` CLI command that runs the full pipeline (scan → infer → render → sign → pack → verify) with interactive prompts at the render step.

**Architecture:** New `all.ts` command file that sequentially calls existing `run*` functions. Uses `ask()` from `prompt.ts` to interactively gather render parameters (locale, format, output path) before the render step.

**Tech Stack:** Node.js, Commander.js, existing prompt utilities

---

### Task 1: Write failing test for `runAll`

**Files:**
- Create: `packages/skillproof-cli/src/commands/all.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getManifestPath } from "../core/manifest.ts";

const execFileAsync = promisify(execFile);

describe("runAll", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-all-"));
    await execFileAsync("git", ["init", tempDir]);
    await execFileAsync("git", ["-C", tempDir, "config", "user.name", "Test Author"]);
    await execFileAsync("git", ["-C", tempDir, "config", "user.email", "test@example.com"]);

    await writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", dependencies: { express: "^4.18.0" } }, null, 2),
      "utf8"
    );
    await writeFile(path.join(tempDir, "index.ts"), 'import express from "express";\nconst app = express();\n', "utf8");
    await execFileAsync("git", ["-C", tempDir, "add", "."]);
    await execFileAsync("git", ["-C", tempDir, "commit", "-m", "init"]);
  });

  after(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("runs full pipeline scan → infer → render → sign → pack → verify", async () => {
    const { runAll } = await import("./all.ts");

    // runAll with no locale, default md format, default output path
    await runAll(tempDir);

    // Verify manifest exists with evidence and skills
    const manifestPath = getManifestPath(tempDir);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.ok(manifest.evidence.length > 0, "should have evidence");
    assert.ok(manifest.skills.length > 0, "should have skills");
    assert.ok(manifest.signatures.length > 0, "should have signatures");

    // Verify resume was rendered
    await access(path.join(tempDir, "resume.md"));

    // Verify bundle was created and is valid
    await access(path.join(tempDir, "bundle.zip"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && node --experimental-strip-types --test src/commands/all.test.ts`
Expected: FAIL — cannot find `./all.ts`

---

### Task 2: Implement `runAll`

**Files:**
- Create: `packages/skillproof-cli/src/commands/all.ts`

**Step 1: Write minimal implementation**

```typescript
import path from "node:path";
import { runScan } from "./scan.ts";
import { runInfer } from "./infer.ts";
import { runRender } from "./render.ts";
import { runSign } from "./sign.ts";
import { runPack } from "./pack.ts";
import { runVerify } from "./verify.ts";
import { ask } from "../core/prompt.ts";

export async function runAll(
  cwd: string,
  options?: { locale?: string; format?: string; output?: string },
): Promise<void> {
  console.log("\n[1/6] Scanning repository...");
  await runScan(cwd);

  console.log("\n[2/6] Inferring skills...");
  await runInfer(cwd);

  // Interactive render parameters (skip if options provided)
  let locale = options?.locale;
  let format = options?.format;
  let output = options?.output;

  if (!options) {
    locale = (await ask("Locale for resume (e.g., en-US, zh-TW — press Enter to skip): ")) || undefined;

    const formatAnswer = await ask("Output format (md, pdf, png, jpeg — default: md): ");
    format = formatAnswer || "md";

    const ext = format === "jpeg" ? "jpg" : format;
    const defaultOutput = path.join(cwd, `resume.${ext}`);
    const outputAnswer = await ask(`Output path (default: ${defaultOutput}): `);
    output = outputAnswer || defaultOutput;
  }

  console.log("\n[3/6] Rendering resume...");
  await runRender(cwd, locale, format, output);

  console.log("\n[4/6] Signing manifest...");
  await runSign(cwd);

  console.log("\n[5/6] Packing bundle...");
  await runPack(cwd);

  const bundlePath = path.join(cwd, "bundle.zip");
  console.log("\n[6/6] Verifying bundle...");
  await runVerify(bundlePath);

  console.log("\nAll done! Bundle ready at: " + bundlePath);
}
```

**Step 2: Run test to verify it passes**

Run: `cd packages/skillproof-cli && node --experimental-strip-types --test src/commands/all.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/skillproof-cli/src/commands/all.ts packages/skillproof-cli/src/commands/all.test.ts
git commit -m "feat: add runAll pipeline function with test"
```

---

### Task 3: Register `all` command in CLI

**Files:**
- Modify: `packages/skillproof-cli/src/index.ts`

**Step 1: Add import and command registration**

Add import at top:
```typescript
import { runAll } from "./commands/all.ts";
```

Add command after existing commands (before `program.parse()`):
```typescript
program
  .command("all")
  .description("Run full pipeline: scan → infer → render → sign → pack → verify")
  .action(async () => {
    await runAll(process.cwd());
  });
```

Update version from `"0.1.4"` to `"0.1.7"`.

**Step 2: Update package.json version**

Change version in `packages/skillproof-cli/package.json` to `"0.1.7"`.

**Step 3: Verify CLI works**

Run: `cd packages/skillproof-cli && node --experimental-strip-types src/index.ts all --help`
Expected: Shows "Run full pipeline: scan → infer → render → sign → pack → verify"

**Step 4: Commit**

```bash
git add packages/skillproof-cli/src/index.ts packages/skillproof-cli/package.json
git commit -m "feat: register all command in CLI, bump to 0.1.7"
```
