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

export function parseBlameOutput(raw: string, authorEmail: string): number {
  const lines = raw.split("\n");
  let totalLines = 0;
  let authorLines = 0;
  let currentEmail = "";

  for (const line of lines) {
    if (line.startsWith("author-mail ")) {
      currentEmail = line.replace("author-mail ", "").replace(/[<>]/g, "");
    } else if (line.startsWith("\t")) {
      totalLines++;
      if (currentEmail === authorEmail) {
        authorLines++;
      }
    }
  }

  if (totalLines === 0) return 0;
  return Math.round((authorLines / totalLines) * 100) / 100;
}

export async function getFileOwnership(
  cwd: string,
  filePath: string,
  authorEmail: string
): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["blame", "--porcelain", "--", filePath],
      { cwd, maxBuffer: 10 * 1024 * 1024 }
    );
    return parseBlameOutput(stdout, authorEmail);
  } catch {
    return 0;
  }
}

export interface RepoId {
  owner: string;
  repo: string;
}

export function parseRepoFromRemote(remoteUrl: string): RepoId | null {
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

export interface PullRequest {
  number: number;
  title: string;
  mergedAt: string;
  url: string;
  additions: number;
  deletions: number;
}

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

export async function isGhAuthenticated(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

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

export async function getGitHubUsername(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api", "user", "--jq", ".login",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
