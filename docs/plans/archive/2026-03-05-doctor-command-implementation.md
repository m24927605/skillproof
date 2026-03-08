# Doctor Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `skillproof doctor` command that checks all prerequisites and a README Prerequisites section.

**Architecture:** Single `doctor.ts` file with a `runDoctor()` function that runs 7 checks sequentially, printing flutter-doctor-style output. Each check is a plain object with label, check function, required flag, and fix hint. No abstraction layer needed for 7 items.

**Tech Stack:** Node.js `child_process.execFile`, `process.version`, Node.js built-in test runner

---

### Task 1: Core check logic and Node.js version check

**Files:**
- Create: `packages/skillproof-cli/src/commands/doctor.ts`
- Create: `packages/skillproof-cli/src/commands/doctor.test.ts`

**Step 1: Write the failing test**

Create `packages/skillproof-cli/src/commands/doctor.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkNodeVersion, type CheckResult } from "./doctor.ts";

describe("doctor", () => {
  describe("checkNodeVersion", () => {
    it("returns pass for Node >= 22", () => {
      const result = checkNodeVersion("v22.5.0");
      assert.equal(result.status, "pass");
      assert.equal(result.label, "Node.js");
      assert.equal(result.detail, "v22.5.0 (>= 22 required)");
    });

    it("returns fail for Node < 22", () => {
      const result = checkNodeVersion("v20.11.0");
      assert.equal(result.status, "fail");
      assert.ok(result.fix);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test 2>&1 | grep -A 2 "checkNodeVersion"`
Expected: FAIL — `checkNodeVersion` is not defined

**Step 3: Write minimal implementation**

Create `packages/skillproof-cli/src/commands/doctor.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CheckResult {
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
  fix?: string;
}

export function checkNodeVersion(version: string): CheckResult {
  const major = parseInt(version.replace("v", "").split(".")[0], 10);
  if (major >= 22) {
    return { label: "Node.js", status: "pass", detail: `${version} (>= 22 required)` };
  }
  return {
    label: "Node.js",
    status: "fail",
    detail: `${version} (>= 22 required)`,
    fix: "nvm install 22",
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test 2>&1 | grep -E "(pass|fail|✓|✗)"`
Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/commands/doctor.ts packages/skillproof-cli/src/commands/doctor.test.ts
git commit -m "feat(doctor): add Node.js version check"
```

---

### Task 2: Git checks (git binary, user.name, user.email)

**Files:**
- Modify: `packages/skillproof-cli/src/commands/doctor.ts`
- Modify: `packages/skillproof-cli/src/commands/doctor.test.ts`

**Step 1: Write the failing tests**

Add to `doctor.test.ts`:

```typescript
import { checkGit, checkGitConfig } from "./doctor.ts";

describe("checkGit", () => {
  it("returns pass when git is available", async () => {
    // This test assumes git is installed on the dev machine
    const result = await checkGit();
    assert.equal(result.status, "pass");
    assert.equal(result.label, "git");
  });
});

describe("checkGitConfig", () => {
  it("returns pass for non-empty value", () => {
    const result = checkGitConfig("user.name", "John Doe");
    assert.equal(result.status, "pass");
    assert.equal(result.detail, "John Doe");
  });

  it("returns fail for empty value", () => {
    const result = checkGitConfig("user.name", "");
    assert.equal(result.status, "fail");
    assert.equal(result.label, "git user.name");
    assert.ok(result.fix);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test 2>&1 | grep -A 2 "checkGit"`
Expected: FAIL — `checkGit` and `checkGitConfig` are not defined

**Step 3: Write minimal implementation**

Add to `doctor.ts`:

```typescript
export async function checkGit(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync("git", ["--version"]);
    const version = stdout.trim().replace("git version ", "");
    return { label: "git", status: "pass", detail: version };
  } catch {
    return {
      label: "git",
      status: "fail",
      detail: "not found",
      fix: "brew install git",
    };
  }
}

export function checkGitConfig(key: string, value: string): CheckResult {
  const label = `git ${key}`;
  if (value.trim()) {
    return { label, status: "pass", detail: value.trim() };
  }
  return {
    label,
    status: "fail",
    detail: "not configured",
    fix: `git config --global ${key} "Your ${key === "user.name" ? "Name" : "Email"}"`,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test 2>&1 | grep -E "(pass|fail|✓|✗)"`
Expected: All new tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/commands/doctor.ts packages/skillproof-cli/src/commands/doctor.test.ts
git commit -m "feat(doctor): add git and git config checks"
```

---

### Task 3: Optional checks (gh CLI, gh auth, unzip)

**Files:**
- Modify: `packages/skillproof-cli/src/commands/doctor.ts`
- Modify: `packages/skillproof-cli/src/commands/doctor.test.ts`

**Step 1: Write the failing tests**

Add to `doctor.test.ts`:

```typescript
import { checkCommand } from "./doctor.ts";

describe("checkCommand", () => {
  it("returns warn for missing optional command", async () => {
    const result = await checkCommand(
      "nonexistent-cmd-xyz",
      ["--version"],
      "test tool",
      false,
      "brew install test"
    );
    assert.equal(result.status, "warn");
    assert.equal(result.label, "test tool");
    assert.ok(result.fix);
  });

  it("returns fail for missing required command", async () => {
    const result = await checkCommand(
      "nonexistent-cmd-xyz",
      ["--version"],
      "test tool",
      true,
      "brew install test"
    );
    assert.equal(result.status, "fail");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test 2>&1 | grep -A 2 "checkCommand"`
Expected: FAIL — `checkCommand` is not defined

**Step 3: Write minimal implementation**

Add to `doctor.ts`:

```typescript
export async function checkCommand(
  cmd: string,
  args: string[],
  label: string,
  required: boolean,
  fix: string
): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync(cmd, args);
    const detail = stdout.trim().split("\n")[0];
    return { label, status: "pass", detail: detail || "available" };
  } catch {
    return {
      label,
      status: required ? "fail" : "warn",
      detail: "not found" + (required ? "" : " (optional)"),
      fix,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test 2>&1 | grep -E "(pass|fail|✓|✗)"`
Expected: All new tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/commands/doctor.ts packages/skillproof-cli/src/commands/doctor.test.ts
git commit -m "feat(doctor): add generic command check for gh/unzip"
```

---

### Task 4: Output formatter and runDoctor

**Files:**
- Modify: `packages/skillproof-cli/src/commands/doctor.ts`
- Modify: `packages/skillproof-cli/src/commands/doctor.test.ts`

**Step 1: Write the failing tests**

Add to `doctor.test.ts`:

```typescript
import { formatResult } from "./doctor.ts";

describe("formatResult", () => {
  it("formats pass with checkmark", () => {
    const line = formatResult({ label: "Node.js", status: "pass", detail: "v22.5.0" });
    assert.ok(line.includes("✓"));
    assert.ok(line.includes("Node.js"));
    assert.ok(line.includes("v22.5.0"));
  });

  it("formats fail with X and fix hint", () => {
    const line = formatResult({ label: "git", status: "fail", detail: "not found", fix: "brew install git" });
    assert.ok(line.includes("✗"));
    assert.ok(line.includes("brew install git"));
  });

  it("formats warn with triangle", () => {
    const line = formatResult({ label: "gh CLI", status: "warn", detail: "not found (optional)", fix: "brew install gh" });
    assert.ok(line.includes("△"));
    assert.ok(line.includes("brew install gh"));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/skillproof-cli && npm test 2>&1 | grep -A 2 "formatResult"`
Expected: FAIL — `formatResult` is not defined

**Step 3: Write minimal implementation**

Add to `doctor.ts`:

```typescript
const STATUS_ICONS: Record<CheckResult["status"], string> = {
  pass: "✓",
  fail: "✗",
  warn: "△",
};

export function formatResult(result: CheckResult): string {
  const icon = STATUS_ICONS[result.status];
  const line = `${icon} ${result.label.padEnd(16)} ${result.detail}`;
  if (result.fix) {
    return `${line}\n  → ${result.fix}`;
  }
  return line;
}

export async function runDoctor(): Promise<void> {
  console.log("SkillProof Doctor");
  console.log("=================");

  const nodeResult = checkNodeVersion(process.version);

  const [gitResult, ghResult, ghAuthResult, unzipResult] = await Promise.all([
    checkGit(),
    checkCommand("gh", ["--version"], "gh CLI", false, "brew install gh && gh auth login"),
    checkCommand("gh", ["auth", "status"], "gh auth", false, "gh auth login"),
    checkCommand("unzip", ["-v"], "unzip", false, "brew install unzip"),
  ]);

  // Git config checks need git to be available
  let nameResult: CheckResult;
  let emailResult: CheckResult;
  if (gitResult.status === "pass") {
    try {
      const { stdout: name } = await execFileAsync("git", ["config", "user.name"]);
      nameResult = checkGitConfig("user.name", name);
    } catch {
      nameResult = checkGitConfig("user.name", "");
    }
    try {
      const { stdout: email } = await execFileAsync("git", ["config", "user.email"]);
      emailResult = checkGitConfig("user.email", email);
    } catch {
      emailResult = checkGitConfig("user.email", "");
    }
  } else {
    nameResult = { label: "git user.name", status: "fail", detail: "git not available" };
    emailResult = { label: "git user.email", status: "fail", detail: "git not available" };
  }

  const results = [nodeResult, gitResult, nameResult, emailResult, ghResult, ghAuthResult, unzipResult];

  for (const r of results) {
    console.log(formatResult(r));
  }

  const hasRequiredFailure = results.some(
    (r) => r.status === "fail"
  );

  console.log("");
  if (hasRequiredFailure) {
    console.log("Some required checks failed. Fix the issues above and run again.");
    process.exitCode = 1;
  } else {
    console.log("All checks passed! You're ready to use SkillProof.");
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/skillproof-cli && npm test 2>&1 | grep -E "(pass|fail|✓|✗)"`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/skillproof-cli/src/commands/doctor.ts packages/skillproof-cli/src/commands/doctor.test.ts
git commit -m "feat(doctor): add output formatter and runDoctor"
```

---

### Task 5: Register doctor command in CLI

**Files:**
- Modify: `packages/skillproof-cli/src/index.ts:1-61`

**Step 1: Add the doctor command registration**

Add import at top of `index.ts` (after line 9):

```typescript
import { runDoctor } from "./commands/doctor.ts";
```

Add command registration before `program.parse()` (before line 61):

```typescript
program
  .command("doctor")
  .description("Check prerequisites for using SkillProof")
  .action(async () => {
    await runDoctor();
  });
```

**Step 2: Build and verify**

Run: `cd packages/skillproof-cli && npm run build && node dist/index.js doctor`
Expected: SkillProof Doctor output with checkmarks/crosses

**Step 3: Run all tests to verify nothing broke**

Run: `cd packages/skillproof-cli && npm test`
Expected: All tests PASS (existing + new doctor tests)

**Step 4: Commit**

```bash
git add packages/skillproof-cli/src/index.ts
git commit -m "feat(doctor): register doctor command in CLI"
```

---

### Task 6: Update README with Prerequisites section

**Files:**
- Modify: `README.md:1-207`

**Step 1: Add Prerequisites section**

Insert after the Installation section (after line 63, before "## The Pipeline"):

```markdown
## Prerequisites

| Requirement | Version | Required | Notes |
|------------|---------|----------|-------|
| Node.js | >= 22 | Yes | For ESM and TypeScript support |
| git | any | Yes | Must be installed and in PATH |
| git user.name | configured | Yes | `git config --global user.name` |
| git user.email | configured | Yes | `git config --global user.email` |
| gh CLI | any | Optional | Enables GitHub PR evidence |
| unzip | any | Optional | Required for `verify` command |

Run `skillproof doctor` to check your environment:

```bash
npx skillproof doctor
```
```

**Step 2: Verify README renders correctly**

Visually review the markdown renders correctly.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Prerequisites section to README"
```

---

### Task 7: Final verification

**Step 1: Run all tests**

Run: `cd packages/skillproof-cli && npm test`
Expected: All tests PASS (existing 46 + new doctor tests)

**Step 2: Build and run doctor end-to-end**

Run: `cd packages/skillproof-cli && npm run build && node dist/index.js doctor`
Expected: Full doctor output with your environment's actual results

**Step 3: Verify help shows doctor**

Run: `cd packages/skillproof-cli && node dist/index.js --help`
Expected: `doctor` appears in command list

**Step 4: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "feat(doctor): complete doctor command implementation"
```
