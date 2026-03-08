# Render Multi-Format Output — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `--format` and `--output` options to render command for PDF/PNG/JPEG output via puppeteer-core + system Chrome.

**Architecture:** Chrome detection module finds system browser, export module converts MD→HTML→target format via puppeteer-core. Render command gains two new options.

**Tech Stack:** TypeScript, puppeteer-core, marked

---

### Task 1: Install dependencies

**Files:**
- Modify: `packages/skillproof/package.json`

**Step 1: Install**

```bash
cd packages/skillproof && npm install puppeteer-core marked && npm install -D @types/marked
```

**Step 2: Verify**

```bash
node -e "import('puppeteer-core').then(() => console.log('puppeteer OK')); import('marked').then(() => console.log('marked OK'))"
```

**Step 3: Commit**

```bash
git add packages/skillproof/package.json packages/skillproof/package-lock.json
git commit -m "chore: add puppeteer-core and marked dependencies"
```

---

### Task 2: Create `core/browser.ts` — Chrome detection

**Files:**
- Create: `packages/skillproof/src/core/browser.ts`
- Create: `packages/skillproof/src/core/browser.test.ts`

**Step 1: Write failing tests**

Create `packages/skillproof/src/core/browser.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getChromePathCandidates } from "./browser.ts";

describe("browser", () => {
  describe("getChromePathCandidates", () => {
    it("returns platform-specific Chrome paths", () => {
      const candidates = getChromePathCandidates();
      assert.ok(Array.isArray(candidates));
      assert.ok(candidates.length > 0);
      for (const c of candidates) {
        assert.equal(typeof c, "string");
      }
    });

    it("includes CHROME_PATH env var when set", () => {
      const original = process.env.CHROME_PATH;
      process.env.CHROME_PATH = "/custom/chrome";
      try {
        const candidates = getChromePathCandidates();
        assert.equal(candidates[0], "/custom/chrome");
      } finally {
        if (original !== undefined) {
          process.env.CHROME_PATH = original;
        } else {
          delete process.env.CHROME_PATH;
        }
      }
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/skillproof && npm test 2>&1 | grep -E "(browser|FAIL|Error)"
```

**Step 3: Write implementation**

Create `packages/skillproof/src/core/browser.ts`:

```typescript
import { access } from "node:fs/promises";
import { constants } from "node:fs";

export function getChromePathCandidates(): string[] {
  const candidates: string[] = [];

  if (process.env.CHROME_PATH) {
    candidates.push(process.env.CHROME_PATH);
  }

  const platform = process.platform;

  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else if (platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
    );
  } else if (platform === "win32") {
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    candidates.push(
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
    );
  }

  return candidates;
}

export async function findChromePath(): Promise<string> {
  const candidates = getChromePathCandidates();

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }

  throw new Error(
    "Chrome not found. Install Google Chrome or set CHROME_PATH environment variable."
  );
}
```

**Step 4: Run tests**

```bash
cd packages/skillproof && npm test 2>&1 | grep -E "(browser|FAIL|PASS)"
```

**Step 5: Commit**

```bash
git add packages/skillproof/src/core/browser.ts packages/skillproof/src/core/browser.test.ts
git commit -m "feat(browser): add Chrome path detection for PDF/image export"
```

---

### Task 3: Create `core/export.ts` — format conversion

**Files:**
- Create: `packages/skillproof/src/core/export.ts`
- Create: `packages/skillproof/src/core/export.test.ts`

**Step 1: Write failing tests**

Create `packages/skillproof/src/core/export.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml, normalizeFormat, type ExportFormat } from "./export.ts";

describe("export", () => {
  describe("normalizeFormat", () => {
    it("accepts valid formats", () => {
      assert.equal(normalizeFormat("md"), "md");
      assert.equal(normalizeFormat("pdf"), "pdf");
      assert.equal(normalizeFormat("png"), "png");
      assert.equal(normalizeFormat("jpeg"), "jpeg");
    });

    it("normalizes jpg to jpeg", () => {
      assert.equal(normalizeFormat("jpg"), "jpeg");
    });

    it("throws for invalid format", () => {
      assert.throws(() => normalizeFormat("docx"), /Unsupported format/);
    });
  });

  describe("markdownToHtml", () => {
    it("converts markdown to styled HTML document", () => {
      const md = "# Hello\n\nWorld";
      const html = markdownToHtml(md);
      assert.ok(html.includes("<html"));
      assert.ok(html.includes("<h1"));
      assert.ok(html.includes("World"));
      assert.ok(html.includes("<style>"));
    });
  });
});
```

**Step 2: Run tests to verify they fail**

**Step 3: Write implementation**

Create `packages/skillproof/src/core/export.ts`:

```typescript
import { marked } from "marked";
import { launch } from "puppeteer-core";
import { findChromePath } from "./browser.ts";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type ExportFormat = "md" | "pdf" | "png" | "jpeg";

export function normalizeFormat(format: string): ExportFormat {
  const lower = format.toLowerCase();
  if (lower === "jpg") return "jpeg";
  if (["md", "pdf", "png", "jpeg"].includes(lower)) return lower as ExportFormat;
  throw new Error(`Unsupported format: ${format}. Use md, pdf, png, jpeg, or jpg.`);
}

export function markdownToHtml(markdown: string): string {
  const body = marked.parse(markdown) as string;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    max-width: 800px;
    margin: 40px auto;
    padding: 0 20px;
    line-height: 1.6;
    color: #333;
  }
  h1 { border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { color: #555; margin-top: 32px; }
  h3 { color: #666; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f4f4f4; padding: 16px; border-radius: 6px; overflow-x: auto; }
  blockquote { border-left: 4px solid #ddd; margin-left: 0; padding-left: 16px; color: #666; }
  details { margin: 16px 0; }
  summary { cursor: pointer; font-weight: bold; }
  hr { border: none; border-top: 1px solid #ddd; margin: 32px 0; }
  ul, ol { padding-left: 24px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export async function exportToFormat(
  markdown: string,
  format: ExportFormat,
  outputPath: string,
): Promise<void> {
  if (format === "md") {
    await writeFile(outputPath, markdown, "utf8");
    return;
  }

  const html = markdownToHtml(markdown);
  const chromePath = await findChromePath();

  // Write HTML to temp file for puppeteer to load
  const tmpHtml = path.join(os.tmpdir(), `skillproof-${Date.now()}.html`);
  await writeFile(tmpHtml, html, "utf8");

  const browser = await launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`file://${tmpHtml}`, { waitUntil: "networkidle0" });

    if (format === "pdf") {
      await page.pdf({
        path: outputPath,
        format: "A4",
        printBackground: true,
        margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      });
    } else {
      // png or jpeg
      await page.screenshot({
        path: outputPath,
        type: format,
        fullPage: true,
        ...(format === "jpeg" ? { quality: 90 } : {}),
      });
    }
  } finally {
    await browser.close();
    await rm(tmpHtml, { force: true });
  }
}
```

**Step 4: Run tests**

```bash
cd packages/skillproof && npm test
```

**Step 5: Commit**

```bash
git add packages/skillproof/src/core/export.ts packages/skillproof/src/core/export.test.ts
git commit -m "feat(export): add MD→HTML→PDF/PNG/JPEG conversion with puppeteer-core"
```

---

### Task 4: Update `commands/render.ts` — add format and output options

**Files:**
- Modify: `packages/skillproof/src/commands/render.ts`

**Step 1: Update runRender signature and logic**

Add `format` and `output` parameters to `runRender`. After generating the markdown content, call `exportToFormat` if format is not `md`, or write directly if it is.

Import the new modules:
```typescript
import { normalizeFormat, exportToFormat, type ExportFormat } from "../core/export.ts";
```

Update the function signature:
```typescript
export async function runRender(
  cwd: string,
  locale?: string,
  format?: string,
  output?: string,
): Promise<void> {
```

At the end of the function, replace the direct file writes with:
```typescript
  const fmt = normalizeFormat(format || "md");
  const outputPath = output || path.join(cwd, `resume.${fmt === "jpeg" ? "jpg" : fmt}`);

  await exportToFormat(fullResume, fmt, outputPath);
  console.log(`Resume written to ${outputPath}`);
```

Apply this pattern to both the locale and non-locale code paths.

**Step 2: Run tests**

```bash
cd packages/skillproof && npm test
```

**Step 3: Commit**

```bash
git add packages/skillproof/src/commands/render.ts
git commit -m "feat(render): add --format and --output options for multi-format export"
```

---

### Task 5: Update `src/index.ts` — register new options

**Files:**
- Modify: `packages/skillproof/src/index.ts`

**Step 1: Add options to render command**

```typescript
program
  .command("render")
  .description("Generate resume from manifest (supports md, pdf, png, jpeg)")
  .argument("[locale]", "Target locale for LLM generation (e.g., zh-TW, ja, en-US)")
  .option("--locale <locale>", "Target locale (alternative to positional argument)")
  .option("--format <format>", "Output format: md, pdf, png, jpeg, jpg (default: md)")
  .option("-o, --output <path>", "Output file path")
  .action(async (localeArg: string | undefined, options: { locale?: string; format?: string; output?: string }) => {
    const locale = localeArg || options.locale;
    await runRender(process.cwd(), locale, options.format, options.output);
  });
```

**Step 2: Build and verify**

```bash
cd packages/skillproof && npm run build && node dist/index.js render --help
```

**Step 3: Commit**

```bash
git add packages/skillproof/src/index.ts
git commit -m "feat(cli): add --format and --output options to render command"
```

---

### Task 6: Update `commands/doctor.ts` — add Chrome check

**Files:**
- Modify: `packages/skillproof/src/commands/doctor.ts`

**Step 1: Add Chrome check**

After the unzip check, add:

```typescript
// 8. Chrome (optional, for PDF/image export)
const chromeCandidates = getChromePathCandidates();
let chromeFound = false;
for (const c of chromeCandidates) {
  try {
    await access(c, constants.X_OK);
    results.push({ label: "Chrome", status: "pass", detail: c });
    chromeFound = true;
    break;
  } catch { /* try next */ }
}
if (!chromeFound) {
  results.push({
    label: "Chrome",
    status: "warn",
    detail: "not found (needed for pdf/png/jpeg export)",
    fix: "Install Google Chrome or set CHROME_PATH",
  });
}
```

Add imports:
```typescript
import { getChromePathCandidates } from "../core/browser.ts";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
```

**Step 2: Run tests**

```bash
cd packages/skillproof && npm test
```

**Step 3: Commit**

```bash
git add packages/skillproof/src/commands/doctor.ts
git commit -m "feat(doctor): add Chrome availability check for export formats"
```

---

### Task 7: Build and run all tests

**Step 1: Build**

```bash
cd packages/skillproof && npm run build
```

**Step 2: Run all tests**

```bash
cd packages/skillproof && npm test
```

**Step 3: Verify CLI**

```bash
node dist/index.js render --help
node dist/index.js doctor
```

Expected: render shows `--format` and `--output` options, doctor shows Chrome check.
