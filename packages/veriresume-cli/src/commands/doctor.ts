import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { promisify } from "node:util";

import { getChromePathCandidates } from "../core/browser.ts";

const execFileAsync = promisify(execFile);

export interface CheckResult {
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
  fix?: string;
}

export function checkNodeVersion(version: string): CheckResult {
  const major = parseInt(version.replace(/^v/, "").split(".")[0], 10);
  return {
    label: "Node.js",
    status: major >= 22 ? "pass" : "fail",
    detail: `${version} (>= 22 required)`,
    ...(major < 22 ? { fix: "nvm install 22" } : {}),
  };
}

export async function checkGit(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync("git", ["--version"]);
    return {
      label: "git",
      status: "pass",
      detail: stdout.trim(),
    };
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
  const trimmed = value.trim();
  if (trimmed) {
    return {
      label: `git ${key}`,
      status: "pass",
      detail: trimmed,
    };
  }
  return {
    label: `git ${key}`,
    status: "fail",
    detail: "not set",
    fix: `git config --global ${key} "Your ${key === "user.name" ? "Name" : "Email"}"`,
  };
}

export async function checkCommand(
  cmd: string,
  args: string[],
  label: string,
  required: boolean,
  fix: string,
): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync(cmd, args);
    return {
      label,
      status: "pass",
      detail: stdout.trim().split("\n")[0],
    };
  } catch {
    return {
      label,
      status: required ? "fail" : "warn",
      detail: required ? "not found" : "not found (optional)",
      fix,
    };
  }
}

const icons: Record<CheckResult["status"], string> = {
  pass: "\u2713",
  fail: "\u2717",
  warn: "\u25B3",
};

export function formatResult(result: CheckResult): string {
  const icon = icons[result.status];
  const line = `${icon} ${result.label.padEnd(16)}${result.detail}`;
  if (result.fix) {
    return `${line}\n  \u2192 ${result.fix}`;
  }
  return line;
}

export async function runDoctor(): Promise<void> {
  console.log("VeriResume Doctor\n=================");

  const results: CheckResult[] = [];

  // 1. Node.js (required)
  results.push(checkNodeVersion(process.version));

  // 2. git (required)
  const gitResult = await checkGit();
  results.push(gitResult);

  // 3. git user.name & 4. git user.email (required)
  let nameResult: CheckResult;
  let emailResult: CheckResult;

  if (gitResult.status === "pass") {
    let userName = "";
    try {
      const { stdout } = await execFileAsync("git", ["config", "user.name"]);
      userName = stdout.trim();
    } catch {
      // leave empty
    }
    nameResult = checkGitConfig("user.name", userName);

    let userEmail = "";
    try {
      const { stdout } = await execFileAsync("git", ["config", "user.email"]);
      userEmail = stdout.trim();
    } catch {
      // leave empty
    }
    emailResult = checkGitConfig("user.email", userEmail);
  } else {
    nameResult = { label: "git user.name", status: "fail", detail: "git not available" };
    emailResult = { label: "git user.email", status: "fail", detail: "git not available" };
  }

  results.push(nameResult);
  results.push(emailResult);

  // 5. gh CLI (optional)
  results.push(
    await checkCommand("gh", ["--version"], "gh CLI", false, "brew install gh && gh auth login"),
  );

  // 6. gh auth (optional)
  results.push(
    await checkCommand("gh", ["auth", "status"], "gh auth", false, "gh auth login"),
  );

  // 7. unzip (required for verify)
  results.push(
    await checkCommand("unzip", ["-v"], "unzip", true, "brew install unzip"),
  );

  // 8. zipinfo (required for verify — Zip Slip protection)
  results.push(
    await checkCommand("zipinfo", ["-h"], "zipinfo", true, "brew install unzip (includes zipinfo)"),
  );

  // 9. Chrome (optional, for PDF/image export)
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

  for (const result of results) {
    console.log(formatResult(result));
  }

  const hasRequiredFailure = results.some(
    (r) => r.status === "fail",
  );

  console.log("");
  if (hasRequiredFailure) {
    console.log("Some required checks failed.");
    process.exitCode = 1;
  } else {
    console.log("All checks passed!");
  }
}
