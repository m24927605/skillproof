import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runScan } from "./scan.ts";
import { runInferStatic } from "./infer.ts";
import { runRender } from "./render.ts";
import { runSign } from "./sign.ts";
import { runPack } from "./pack.ts";
import { verifyBundle } from "./verify.ts";
import { getManifestPath } from "../core/manifest.ts";

const execFileAsync = promisify(execFile);

describe("integration: full pipeline", () => {
  let tempDir: string;
  let manifestPath: string;
  let bundlePath: string;

  before(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "veriresume-integration-"));
    manifestPath = getManifestPath(tempDir);
    bundlePath = path.join(tempDir, "bundle.zip");

    // git init and configure user
    await execFileAsync("git", ["init", tempDir]);
    await execFileAsync("git", ["-C", tempDir, "config", "user.name", "Test Author"]);
    await execFileAsync("git", ["-C", tempDir, "config", "user.email", "test@example.com"]);

    // Create package.json with dependencies
    const packageJson = JSON.stringify(
      {
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          express: "^4.18.0",
          redis: "^4.6.0",
        },
      },
      null,
      2
    );
    await writeFile(path.join(tempDir, "package.json"), packageJson, "utf8");

    // Create index.ts
    const indexTs = `import express from "express";
import { createClient } from "redis";

const app = express();
const client = createClient();

app.get("/", (_req, res) => res.send("hello"));
app.listen(3000);
`;
    await writeFile(path.join(tempDir, "index.ts"), indexTs, "utf8");

    // Create Dockerfile
    const dockerfile = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["node", "dist/index.js"]
`;
    await writeFile(path.join(tempDir, "Dockerfile"), dockerfile, "utf8");

    // git add and commit
    await execFileAsync("git", ["-C", tempDir, "add", "."]);
    await execFileAsync("git", ["-C", tempDir, "commit", "-m", "feat: initial commit"]);
  });

  after(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("scan -> infer -> render -> sign -> pack -> verify", async () => {
    // Step 1: Scan
    await runScan(tempDir);
    await access(manifestPath);
    const manifestAfterScan = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.ok(manifestAfterScan.evidence.length > 0, "manifest should have evidence");

    // Verify file evidence has real content hashes (not path hashes)
    const fileEvidence = manifestAfterScan.evidence.filter(
      (e: { type: string; hash: string; ownership: number }) => e.type === "file"
    );
    for (const fe of fileEvidence) {
      assert.equal(fe.hash.length, 64, "file evidence should have SHA-256 hash");
      assert.ok(fe.ownership >= 0 && fe.ownership <= 1, "ownership should be 0-1");
    }

    // Step 2: Infer
    await runInferStatic(manifestPath);
    const manifestAfterInfer = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.ok(manifestAfterInfer.skills.length > 0, "should have inferred skills");
    const skillNames = manifestAfterInfer.skills.map((s: { name: string }) => s.name);
    assert.ok(skillNames.includes("Docker"), "should infer Docker skill");
    assert.ok(skillNames.includes("Redis"), "should infer Redis skill");

    // Step 3: Render
    await runRender(tempDir);
    const resumePath = path.join(tempDir, "resume.md");
    await access(resumePath);
    const resumeContent = await readFile(resumePath, "utf8");
    assert.ok(resumeContent.includes("Test Author"), "resume should contain author name");

    // Step 4: Sign
    await runSign(tempDir);
    const manifestAfterSign = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifestAfterSign.signatures.length, 1, "manifest should have 1 signature");
    assert.equal(manifestAfterSign.signatures[0].algorithm, "Ed25519");

    // Step 5: Pack
    await runPack(tempDir);
    await access(bundlePath);

    // Step 6: Verify
    const result = await verifyBundle(bundlePath);
    assert.equal(result.valid, true, "bundle should be valid");
    assert.equal(result.signatures.length, 1);
    assert.equal(result.signatures[0].valid, true);
  });
});
