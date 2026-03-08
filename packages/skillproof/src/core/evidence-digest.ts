import type { Evidence } from "../types/manifest.js";
import type { StaticQualityResult } from "./static-quality.js";

export interface EvidenceDigest {
  summaryLines: string[];
  snippetBlocks: Array<{
    path: string;
    note: string;
    content: string;
  }>;
}

/** Maximum number of snippet blocks per skill digest */
const MAX_SNIPPETS = 5;
/** Maximum characters per snippet */
const MAX_SNIPPET_CHARS = 2000;

export function buildEvidenceDigest(
  skill: string,
  evidence: Evidence[],
  staticResult: StaticQualityResult,
  fileContents: Map<string, string>,
): EvidenceDigest {
  const summaryLines = buildSummaryLines(skill, evidence, staticResult);
  const snippetBlocks = buildSnippetBlocks(evidence, fileContents);
  return { summaryLines, snippetBlocks };
}

function buildSummaryLines(
  skill: string,
  evidence: Evidence[],
  staticResult: StaticQualityResult,
): string[] {
  const lines: string[] = [];
  const { signals } = staticResult;

  // Evidence type summary
  if (signals.file_count > 0) {
    const owned = signals.owned_file_count;
    lines.push(`Owned ${owned} of ${signals.file_count} ${skill} file(s)`);
  }
  if (signals.test_file_count > 0) {
    lines.push(`Has ${signals.test_file_count} test file(s)`);
  }
  if (signals.snippet_count > 0) {
    lines.push(`${signals.snippet_count} code snippet(s)`);
  }
  if (signals.dependency_count > 0) {
    const depSources = evidence
      .filter((ev) => ev.type === "dependency")
      .map((ev) => ev.source);
    lines.push(`${signals.dependency_count} dependency(ies) from ${[...new Set(depSources)].join(", ")}`);
  }
  if (signals.config_evidence_count > 0) {
    const configSources = evidence
      .filter((ev) => ev.type === "config")
      .map((ev) => ev.source);
    lines.push(`Config: ${configSources.join(", ")}`);
  }
  if (signals.commit_count > 0) {
    lines.push(`${signals.commit_count} related commit(s)`);
  }
  if (signals.pr_count > 0) {
    lines.push(`${signals.pr_count} pull request(s)`);
  }

  // Quality signals
  if (signals.has_ci) lines.push("CI/CD pipeline configured");
  if (signals.has_lint) lines.push("Linting configured");
  if (signals.has_types) lines.push("Type checking configured");
  if (signals.has_error_handling) lines.push("Error handling present");
  if (signals.has_validation) lines.push("Input validation present");

  // Fallback for empty evidence
  if (lines.length === 0) {
    lines.push("Minimal evidence available");
  }

  return lines;
}

function buildSnippetBlocks(
  evidence: Evidence[],
  fileContents: Map<string, string>,
): EvidenceDigest["snippetBlocks"] {
  // Get file evidence sorted by ownership descending
  const fileEvidence = evidence
    .filter((ev) => ev.type === "file")
    .sort((a, b) => b.ownership - a.ownership);

  const blocks: EvidenceDigest["snippetBlocks"] = [];

  for (const ev of fileEvidence) {
    if (blocks.length >= MAX_SNIPPETS) break;

    const content = fileContents.get(ev.source);
    if (!content) continue;

    const TRUNCATION_SUFFIX = "\n// ... truncated";
    const truncated = content.length > MAX_SNIPPET_CHARS
      ? content.slice(0, MAX_SNIPPET_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
      : content;

    blocks.push({
      path: ev.source,
      note: `ownership: ${Math.round(ev.ownership * 100)}%`,
      content: truncated,
    });
  }

  return blocks;
}
