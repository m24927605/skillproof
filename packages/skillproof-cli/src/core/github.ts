import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitHubRepo {
  name: string;
  cloneUrl: string;
  source: string;
}

export function parseRepoListJson(json: string): GitHubRepo[] {
  const raw = JSON.parse(json) as Array<{
    name: string;
    url: string;
    owner: { login: string };
  }>;
  return raw.map((r) => ({
    name: r.name,
    cloneUrl: r.url,
    source: "my repos",
  }));
}

export function deduplicateRepos(repos: GitHubRepo[]): GitHubRepo[] {
  const seen = new Map<string, GitHubRepo>();
  for (const repo of repos) {
    if (!seen.has(repo.cloneUrl)) {
      seen.set(repo.cloneUrl, repo);
    }
  }
  return [...seen.values()];
}

export async function fetchMyRepos(): Promise<GitHubRepo[]> {
  try {
    const { stdout } = await execFileAsync("gh", [
      "repo", "list", "--json", "name,url,owner", "--limit", "200",
    ]);
    return parseRepoListJson(stdout).map((r) => ({ ...r, source: "my repos" }));
  } catch {
    console.warn("Failed to fetch your repositories.");
    return [];
  }
}

export async function fetchContributedRepos(): Promise<GitHubRepo[]> {
  try {
    const { stdout: userJson } = await execFileAsync("gh", [
      "api", "/user", "--jq", ".login",
    ]);
    const login = userJson.trim();

    const { stdout } = await execFileAsync("gh", [
      "api", "/user/repos?type=all&per_page=100&sort=pushed",
    ]);
    const raw = JSON.parse(stdout) as Array<{
      name: string;
      clone_url: string;
      owner: { login: string };
    }>;
    return raw
      .filter((r) => r.owner.login !== login)
      .map((r) => ({
        name: `${r.owner.login}/${r.name}`,
        cloneUrl: r.clone_url,
        source: "contributed",
      }));
  } catch {
    console.warn("Failed to fetch contributed repositories.");
    return [];
  }
}

export async function fetchOrgRepos(org: string): Promise<GitHubRepo[]> {
  if (!/^[a-zA-Z0-9_-]+$/.test(org)) {
    console.warn(`Invalid organization name: ${org}`);
    return [];
  }
  try {
    const { stdout } = await execFileAsync("gh", [
      "api", `/orgs/${org}/repos?per_page=100&type=all`,
    ]);
    const raw = JSON.parse(stdout) as Array<{
      name: string;
      clone_url: string;
    }>;
    return raw.map((r) => ({
      name: `${org}/${r.name}`,
      cloneUrl: r.clone_url,
      source: `org: ${org}`,
    }));
  } catch {
    console.warn(`Failed to fetch repositories for org: ${org}`);
    return [];
  }
}

export async function fetchGitHubRepos(
  sources: { myRepos: boolean; contributed: boolean; orgs: string[] }
): Promise<GitHubRepo[]> {
  const all: GitHubRepo[] = [];

  if (sources.myRepos) {
    all.push(...await fetchMyRepos());
  }
  if (sources.contributed) {
    all.push(...await fetchContributedRepos());
  }
  for (const org of sources.orgs) {
    all.push(...await fetchOrgRepos(org));
  }

  return deduplicateRepos(all);
}
