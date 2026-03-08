import type { Evidence } from "../types/manifest.js";

export interface StaticQualitySignals {
  file_count: number;
  owned_file_count: number;
  test_file_count: number;
  config_file_count: number;
  dependency_count: number;
  config_evidence_count: number;
  commit_count: number;
  pr_count: number;
  snippet_count: number;
  has_ci: boolean;
  has_lint: boolean;
  has_types: boolean;
  has_error_handling: boolean;
  has_validation: boolean;
}

export interface StaticQualityResult {
  score: number;
  reasons: string[];
  signals: StaticQualitySignals;
}

const TEST_PATTERN = /\.(test|spec)\.[jt]sx?$|__tests__|test_|_test\.py$/i;
const CI_PATTERN = /\.github\/workflows\/|\.gitlab-ci|jenkinsfile|\.circleci|\.travis/i;
const LINT_PATTERN = /eslint|\.prettierrc|biome\.json|\.stylelintrc|pylint|flake8|rubocop/i;
const TYPES_PATTERN = /tsconfig|\.d\.ts$|py\.typed|mypy\.ini|pyrightconfig/i;
const OWNERSHIP_THRESHOLD = 0.5;

/** Conservative base score for dependency/config-only skills */
const DEP_ONLY_BASE = 0.25;
/** Base score when file evidence exists */
const FILE_BASE = 0.35;
/** Maximum cap for dependency/config-only skills */
const DEP_ONLY_CAP = 0.5;

export function analyzeStaticQuality(
  _skill: string,
  evidence: Evidence[],
): StaticQualityResult {
  const signals = extractSignals(evidence);
  const reasons: string[] = [];
  const hasFileEvidence = signals.file_count > 0 || signals.snippet_count > 0;

  // Base score depends on evidence type mix
  let score: number;
  if (hasFileEvidence) {
    score = FILE_BASE;
    reasons.push(`${signals.file_count} file(s), ${signals.snippet_count} snippet(s)`);
  } else if (signals.dependency_count > 0 || signals.config_evidence_count > 0) {
    score = DEP_ONLY_BASE;
    reasons.push(`${signals.dependency_count} dependency(ies), ${signals.config_evidence_count} config(s)`);
  } else if (signals.commit_count > 0 || signals.pr_count > 0) {
    score = DEP_ONLY_BASE;
    reasons.push(`${signals.commit_count} commit(s), ${signals.pr_count} PR(s)`);
  } else {
    score = 0.1;
    reasons.push("Minimal evidence");
  }

  // Ownership boost: high-ownership files indicate stronger skill signal
  if (signals.owned_file_count > 0) {
    const ownershipBoost = Math.min(0.15, signals.owned_file_count * 0.05);
    score += ownershipBoost;
    reasons.push(`${signals.owned_file_count} owned file(s)`);
  }

  // Test presence boost
  if (signals.test_file_count > 0) {
    score += 0.1;
    reasons.push(`${signals.test_file_count} test file(s)`);
  }

  // CI boost
  if (signals.has_ci) {
    score += 0.05;
    reasons.push("CI/CD configured");
  }

  // Lint boost
  if (signals.has_lint) {
    score += 0.05;
    reasons.push("Linting configured");
  }

  // Types boost
  if (signals.has_types) {
    score += 0.05;
    reasons.push("Type checking configured");
  }

  // Commit/PR supplementary boost (small, does not override file signals)
  if (signals.commit_count > 0) {
    score += Math.min(0.05, signals.commit_count * 0.01);
  }
  if (signals.pr_count > 0) {
    score += Math.min(0.05, signals.pr_count * 0.02);
  }

  // Apply cap for dependency/config-only skills
  if (!hasFileEvidence) {
    score = Math.min(score, DEP_ONLY_CAP);
  }

  // Clamp to 0..1
  score = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;

  return { score, reasons, signals };
}

function extractSignals(evidence: Evidence[]): StaticQualitySignals {
  let file_count = 0;
  let owned_file_count = 0;
  let test_file_count = 0;
  let config_file_count = 0;
  let dependency_count = 0;
  let config_evidence_count = 0;
  let commit_count = 0;
  let pr_count = 0;
  let snippet_count = 0;
  let has_ci = false;
  let has_lint = false;
  let has_types = false;
  const has_error_handling = false;
  const has_validation = false;

  for (const ev of evidence) {
    switch (ev.type) {
      case "file": {
        file_count++;
        if (ev.ownership >= OWNERSHIP_THRESHOLD) owned_file_count++;
        if (TEST_PATTERN.test(ev.source)) test_file_count++;
        if (CI_PATTERN.test(ev.source)) { config_file_count++; has_ci = true; }
        if (LINT_PATTERN.test(ev.source)) { config_file_count++; has_lint = true; }
        if (TYPES_PATTERN.test(ev.source)) { config_file_count++; has_types = true; }
        break;
      }
      case "dependency":
        dependency_count++;
        break;
      case "config": {
        config_evidence_count++;
        if (CI_PATTERN.test(ev.source)) has_ci = true;
        if (LINT_PATTERN.test(ev.source)) has_lint = true;
        if (TYPES_PATTERN.test(ev.source)) has_types = true;
        break;
      }
      case "commit":
        commit_count++;
        break;
      case "pull_request":
        pr_count++;
        break;
      case "snippet":
        snippet_count++;
        break;
    }
  }

  return {
    file_count,
    owned_file_count,
    test_file_count,
    config_file_count,
    dependency_count,
    config_evidence_count,
    commit_count,
    pr_count,
    snippet_count,
    has_ci,
    has_lint,
    has_types,
    has_error_handling,
    has_validation,
  };
}
