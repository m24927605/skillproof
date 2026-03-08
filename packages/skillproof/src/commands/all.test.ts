import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getManifestPath } from "../core/manifest.ts";

const execFileAsync = promisify(execFile);

describe("runAll --dry-run", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skillproof-dryrun-"));
    await execFileAsync("git", ["init", tempDir]);
    await execFileAsync("git", ["-C", tempDir, "config", "user.name", "Test Author"]);
    await execFileAsync("git", ["-C", tempDir, "config", "user.email", "test@example.com"]);
    await writeFile(path.join(tempDir, "index.ts"), 'const x: number = 1;\n', "utf8");
    await execFileAsync("git", ["-C", tempDir, "add", "."]);
    await execFileAsync("git", ["-C", tempDir, "commit", "-m", "init"]);
  });

  after(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("stops after infer without writing resume or bundle", async () => {
    const { runAll } = await import("./all.ts");
    // Should not throw even without API key
    await runAll(tempDir, { scanMode: "current", dryRun: true });

    // No bundle should be created
    await assert.rejects(access(path.join(tempDir, "bundle.zip")));
    // No resume should be created
    await assert.rejects(access(path.join(tempDir, "resume.md")));
  });
});

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

  it("runs full pipeline scan → infer → sign → render → pack → verify", async () => {
    const { runAll } = await import("./all.ts");

    // runAll with current project scan mode, default md format (skip interactive)
    await runAll(tempDir, { scanMode: "current", format: "md", skipLlm: true });

    // Verify manifest exists with evidence and skills
    const manifestPath = getManifestPath(tempDir);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.ok(manifest.evidence.length > 0, "should have evidence");
    assert.ok(manifest.skills.length > 0, "should have skills");
    assert.ok(manifest.signatures.length > 0, "should have signatures");

    // Verify resume was rendered
    await access(path.join(tempDir, "resume.md"));

    // Verify bundle was created
    await access(path.join(tempDir, "bundle.zip"));
  });
});
