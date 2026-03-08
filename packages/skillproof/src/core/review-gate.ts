export interface ReviewGateInput {
  skill: string;
  staticConfidence: number;
  evidenceCount: number;
  fileEvidenceCount: number;
  staticReasons: string[];
}

export interface ReviewGateResult {
  priority: number;
  shouldReview: boolean;
  reason: string;
}

/**
 * High-value skills that benefit most from LLM review.
 * These get reviewed even at higher static confidence.
 */
const HIGH_VALUE_SKILLS = new Set([
  // Languages
  "TypeScript", "JavaScript", "Python", "Go", "Rust", "Java",
  // Frameworks
  "React", "Next.js", "Express", "FastAPI",
  // Infrastructure
  "Docker", "Kubernetes", "Terraform",
  // Practices
  "Code Review", "Testing", "Architecture",
]);

/** Below this static confidence, evidence is too weak to justify LLM spend */
const MIN_CONFIDENCE_FOR_REVIEW = 0.2;
/** Above this, non-high-value skills are considered overdetermined */
const STRONG_CONFIDENCE_THRESHOLD = 0.75;
/** High-value skills get reviewed up to this confidence */
const HIGH_VALUE_CONFIDENCE_CAP = 0.9;
/** Minimum file evidence to justify review for weak skills */
const MIN_FILE_EVIDENCE = 1;

export function decideSkillReview(input: ReviewGateInput): ReviewGateResult {
  const { skill, staticConfidence, evidenceCount, fileEvidenceCount } = input;
  const isHighValue = HIGH_VALUE_SKILLS.has(skill);

  // Skip: evidence too weak to justify review
  if (staticConfidence < MIN_CONFIDENCE_FOR_REVIEW || (evidenceCount <= 1 && fileEvidenceCount === 0)) {
    return {
      priority: 0,
      shouldReview: false,
      reason: `Evidence too weak for LLM review (confidence: ${staticConfidence}, files: ${fileEvidenceCount})`,
    };
  }

  // Skip: non-high-value skill with strong confidence and abundant evidence
  if (!isHighValue && staticConfidence >= STRONG_CONFIDENCE_THRESHOLD) {
    return {
      priority: 0,
      shouldReview: false,
      reason: `Strong static confidence (${staticConfidence}) for non-core skill "${skill}"`,
    };
  }

  // Skip: high-value but already overdetermined
  if (isHighValue && staticConfidence >= HIGH_VALUE_CONFIDENCE_CAP) {
    return {
      priority: 0,
      shouldReview: false,
      reason: `Overdetermined high-value skill "${skill}" (confidence: ${staticConfidence})`,
    };
  }

  // Skip: no file evidence for review to work with (even if high-value)
  if (fileEvidenceCount < MIN_FILE_EVIDENCE) {
    return {
      priority: 0,
      shouldReview: false,
      reason: `No file evidence for LLM review of "${skill}"`,
    };
  }

  // Review: compute priority
  // Priority is higher when:
  //   - confidence is in the uncertain mid-range (0.4-0.7 is most uncertain)
  //   - skill is high-value
  //   - file evidence exists but isn't overwhelming
  const uncertaintyScore = 1 - Math.abs(staticConfidence - 0.55) / 0.55;
  const highValueBoost = isHighValue ? 0.2 : 0;
  const priority = Math.round(Math.max(0, Math.min(1, uncertaintyScore + highValueBoost)) * 100) / 100;

  return {
    priority,
    shouldReview: true,
    reason: isHighValue
      ? `High-value skill "${skill}" with uncertain confidence (${staticConfidence})`
      : `Mid-range confidence (${staticConfidence}) for "${skill}" with ${fileEvidenceCount} file(s)`,
  };
}
