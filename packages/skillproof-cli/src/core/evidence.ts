import type { Evidence } from "../types/manifest.ts";
import type { GitCommit } from "./git.ts";
import { hashContent } from "./hashing.ts";

export function createCommitEvidence(commit: GitCommit): Evidence {
  return {
    id: `EV-COMMIT-${commit.hash}`,
    type: "commit",
    hash: hashContent(`${commit.hash}|${commit.message}`),
    timestamp: commit.date,
    ownership: 1.0,
    source: commit.hash,
    metadata: { message: commit.message },
  };
}

export function createFileEvidence(
  filePath: string,
  content: string,
  ownership: number
): Evidence {
  const hash = hashContent(content);
  return {
    id: `EV-FILE-${hash.substring(0, 12)}`,
    type: "file",
    hash,
    timestamp: new Date().toISOString(),
    ownership,
    source: filePath,
  };
}

export function createDependencyEvidence(
  name: string,
  sourceFile: string
): Evidence {
  return {
    id: `EV-DEP-${name}`,
    type: "dependency",
    hash: hashContent(name),
    timestamp: new Date().toISOString(),
    ownership: 1.0,
    source: sourceFile,
  };
}

export function createConfigEvidence(
  filePath: string,
  content: string
): Evidence {
  const hash = hashContent(content);
  return {
    id: `EV-CONFIG-${hash.substring(0, 12)}`,
    type: "config",
    hash,
    timestamp: new Date().toISOString(),
    ownership: 1.0,
    source: filePath,
  };
}

export function createSnippetEvidence(
  filePath: string,
  snippet: string,
  ownership: number
): Evidence {
  const hash = hashContent(snippet);
  return {
    id: `EV-SNIPPET-${hash.substring(0, 12)}`,
    type: "snippet",
    hash,
    timestamp: new Date().toISOString(),
    ownership,
    source: filePath,
    metadata: { lines: snippet.split("\n").length },
  };
}

export interface PRInput {
  number: number;
  title: string;
  mergedAt: string;
  url: string;
  additions: number;
  deletions: number;
}

export function createPREvidence(pr: PRInput): Evidence {
  return {
    id: `EV-PR-${pr.number}`,
    type: "pull_request",
    hash: hashContent(`PR#${pr.number}|${pr.title}`),
    timestamp: pr.mergedAt,
    ownership: 1.0,
    source: pr.url,
    metadata: {
      title: pr.title,
      additions: pr.additions,
      deletions: pr.deletions,
    },
  };
}
