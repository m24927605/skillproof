import { readdir, stat, rm, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { scanRepo } from "./scan.ts";
import { collectAllEmails } from "../core/identity.ts";
import { fetchGitHubRepos, type GitHubRepo } from "../core/github.ts";
import { mergeManifests } from "../core/merge.ts";
import { checkboxPrompt, ask } from "../core/prompt.ts";
import { writeManifest, getManifestPath, createEmptyManifest } from "../core/manifest.ts";
import type { Manifest } from "../types/manifest.ts";

const execFileAsync = promisify(execFile);

export interface LocalRepo {
  name: string;
  path: string;
}

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
            continue; // Don't recurse into git repos
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

async function cloneRepo(cloneUrl: string, targetDir: string): Promise<void> {
  await execFileAsync("git", ["clone", cloneUrl, targetDir], {
    timeout: 300000, // 5 minute timeout per clone
  });
}

async function runLocalMode(
  cwd: string,
  preSelected?: { repos?: string[]; emails?: string[] },
): Promise<void> {
  const repos = await discoverLocalRepos(cwd);
  if (repos.length === 0) {
    console.log("No git repositories found in current directory.");
    return;
  }

  let selected: LocalRepo[];
  if (preSelected?.repos && preSelected.repos.length > 0) {
    const repoNames = new Set(preSelected.repos);
    selected = repos.filter((r) => repoNames.has(r.name));
    if (selected.length === 0) {
      console.log("None of the specified repos were found.");
      return;
    }
  } else {
    selected = await checkboxPrompt<LocalRepo>(
      "Select repositories to scan",
      repos.map((r) => ({ name: r.name, value: r }))
    );
    if (selected.length === 0) {
      console.log("No repositories selected.");
      return;
    }
  }

  let confirmedEmails: string[];
  if (preSelected?.emails && preSelected.emails.length > 0) {
    confirmedEmails = preSelected.emails;
  } else {
    // Collect and confirm emails
    const emailCandidates = await collectAllEmails(selected);
    confirmedEmails = await checkboxPrompt<string>(
      "Confirm your email addresses (used for ownership calculation)",
      emailCandidates.map((e) => ({
        name: `${e.email} (${e.sources.join(", ")})`,
        value: e.email,
        checked: e.sources.some((s) => s === "git config" || s === "github"),
      }))
    );
  }
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
  const tmpBase = path.join(os.tmpdir(), `veriresume-clone-${Date.now()}`);
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
      const targetDir = path.join(tmpBase, repo.name.replaceAll("/", "--"));
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

export async function runScanMulti(
  cwd: string,
  github: boolean,
  preSelected?: { repos?: string[]; emails?: string[] },
): Promise<void> {
  if (github) {
    await runGitHubMode(cwd);
  } else {
    await runLocalMode(cwd, preSelected);
  }
}
