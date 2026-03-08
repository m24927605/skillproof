import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface EmailCandidate {
  email: string;
  sources: string[];
}

export function deduplicateEmails(candidates: EmailCandidate[]): EmailCandidate[] {
  const map = new Map<string, EmailCandidate>();
  for (const c of candidates) {
    const key = c.email.toLowerCase();
    const existing = map.get(key);
    if (existing) {
      existing.sources.push(...c.sources);
    } else {
      map.set(key, { email: c.email, sources: [...c.sources] });
    }
  }
  return [...map.values()];
}

export function mergeEmailSources(sources: EmailCandidate[][]): EmailCandidate[] {
  const all = sources.flat();
  return deduplicateEmails(all);
}

export async function getGitConfigEmail(): Promise<EmailCandidate | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--global", "user.email"]);
    const email = stdout.trim();
    return email ? { email, sources: ["git config"] } : null;
  } catch {
    return null;
  }
}

export async function getGitHubEmails(): Promise<EmailCandidate[]> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api", "/user/emails", "--jq", ".[].email",
    ]);
    return stdout
      .split("\n")
      .map((e) => e.trim())
      .filter((e) => e.length > 0)
      .map((email) => ({ email, sources: ["github"] }));
  } catch {
    return [];
  }
}

export async function getRepoLogEmails(cwd: string, repoName: string): Promise<EmailCandidate[]> {
  try {
    const { stdout } = await execFileAsync(
      "git", ["log", "--format=%ae%n%ce", "--all"],
      { cwd }
    );
    const emails = [...new Set(
      stdout.split("\n").map((e) => e.trim()).filter((e) => e.length > 0)
    )];
    return emails.map((email) => ({ email, sources: [`git log: ${repoName}`] }));
  } catch {
    return [];
  }
}

export async function collectAllEmails(
  repoPaths: { path: string; name: string }[]
): Promise<EmailCandidate[]> {
  const sources: EmailCandidate[][] = [];

  const gitConfig = await getGitConfigEmail();
  if (gitConfig) sources.push([gitConfig]);

  const githubEmails = await getGitHubEmails();
  if (githubEmails.length > 0) sources.push(githubEmails);

  for (const repo of repoPaths) {
    const logEmails = await getRepoLogEmails(repo.path, repo.name);
    if (logEmails.length > 0) sources.push(logEmails);
  }

  return mergeEmailSources(sources);
}
