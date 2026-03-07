import type { Evidence } from "../types/manifest.ts";
import type { GitCommit, PullRequest } from "../core/git.ts";
import {
  createCommitEvidence,
  createDependencyEvidence,
  createConfigEvidence,
  createFileEvidence,
  createPREvidence,
} from "../core/evidence.ts";
import { isSensitivePath, containsSecrets } from "../core/security.ts";
import {
  getGitLog,
  getGitUser,
  getHeadCommit,
  getRemoteUrl,
  getTrackedFiles,
  getFileOwnership,
  isGhAuthenticated,
  getGitHubUsername,
  getAuthorPRs,
  parseRepoFromRemote,
} from "../core/git.ts";
import {
  createEmptyManifest,
  writeManifest,
  getManifestPath,
} from "../core/manifest.ts";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface ScanInput {
  commits: GitCommit[];
  files: { path: string; content: string; ownership: number }[];
  dependencies: { name: string; source: string }[];
  configFiles: { path: string; content: string }[];
  pullRequests: PullRequest[];
}

export function buildEvidence(input: ScanInput): Evidence[] {
  const evidence: Evidence[] = [];

  for (const commit of input.commits) {
    evidence.push(createCommitEvidence(commit));
  }

  for (const file of input.files) {
    if (!isSensitivePath(file.path) && !containsSecrets(file.content)) {
      evidence.push(createFileEvidence(file.path, file.content, file.ownership));
    }
  }

  for (const dep of input.dependencies) {
    evidence.push(createDependencyEvidence(dep.name, dep.source));
  }

  for (const cfg of input.configFiles) {
    evidence.push(createConfigEvidence(cfg.path, cfg.content));
  }

  for (const pr of input.pullRequests) {
    evidence.push(createPREvidence(pr));
  }

  return evidence;
}

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const BLAME_CONCURRENCY = 10;

const CONFIG_PATTERNS = [
  /^Dockerfile/i,
  /^docker-compose/i,
  /\.github\/workflows\//,
  /\.tf$/,
  /helm\//,
  /\.k8s\//,
  /serverless\.(yml|yaml|json)$/,
];

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
  "Cargo.toml": (content) => parseCargoDeps(content),
};

async function batchBlame(
  cwd: string,
  filePaths: string[],
  authorEmails: string[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  for (let i = 0; i < filePaths.length; i += BLAME_CONCURRENCY) {
    const batch = filePaths.slice(i, i + BLAME_CONCURRENCY);
    const ownershipResults = await Promise.all(
      batch.map(async (fp) => {
        const perEmail = await Promise.all(
          authorEmails.map((email) => getFileOwnership(cwd, fp, email))
        );
        return Math.max(...perEmail);
      })
    );
    batch.forEach((fp, idx) => results.set(fp, ownershipResults[idx]));
  }
  return results;
}

export interface ScanResult {
  evidence: Evidence[];
  repoUrl: string | null;
  headCommit: string;
  authorName: string;
  authorEmail: string;
}

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

  // Read file contents + compute blame ownership
  const eligibleFiles = trackedFiles.filter(
    (fp) => !isSensitivePath(fp) && !CONFIG_PATTERNS.some((p) => p.test(fp))
  );

  // Filter by file size
  const sizedFiles: string[] = [];
  for (const fp of eligibleFiles) {
    try {
      const s = await stat(path.join(cwd, fp));
      if (s.size <= MAX_FILE_SIZE) sizedFiles.push(fp);
    } catch {
      // skip
    }
  }

  // Batch blame
  console.log(`Computing ownership for ${sizedFiles.length} files...`);
  const ownershipMap = await batchBlame(cwd, sizedFiles, emails);

  // Read file contents
  const files: { path: string; content: string; ownership: number }[] = [];
  for (const fp of sizedFiles) {
    try {
      const content = await readFile(path.join(cwd, fp), "utf8");
      files.push({ path: fp, content, ownership: ownershipMap.get(fp) ?? 0 });
    } catch {
      // skip binary/unreadable files
    }
  }

  // GitHub PR evidence (graceful degradation)
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
    } else {
      console.log("GitHub not authenticated or not a GitHub repo. Skipping PR evidence.");
    }
  }

  const evidence = buildEvidence({
    commits,
    files,
    dependencies,
    configFiles,
    pullRequests,
  });

  return {
    evidence,
    repoUrl: remoteUrl,
    headCommit,
    authorName: user.name,
    authorEmail: primaryEmail,
  };
}

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
