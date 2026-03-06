const INPUT_PRICE_PER_TOKEN = 3 / 1_000_000;   // $3 per 1M input tokens
const OUTPUT_PRICE_PER_TOKEN = 15 / 1_000_000;  // $15 per 1M output tokens
const SYSTEM_PROMPT_TOKENS = 300;
const OUTPUT_TOKENS_PER_SKILL = 200;
const MAX_LINES_PER_FILE = 150;
const SAMPLED_FILES_PER_SKILL = 3;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return inputTokens * INPUT_PRICE_PER_TOKEN + outputTokens * OUTPUT_PRICE_PER_TOKEN;
}

export function truncateFileContent(content: string, maxLines: number = MAX_LINES_PER_FILE): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join("\n") + "\n// ... truncated";
}

export interface FileForReview {
  path: string;
  content: string;
  ownership: number;
  skill: string;
}

export interface EstimateInput {
  eligibleFiles: number;
  skillCount: number;
  fullInputTokens: number;
  fullOutputTokens: number;
  sampledInputTokens: number;
  sampledOutputTokens: number;
  sampledFilesPerSkill: number;
}

export function estimateReviewTokens(
  filesBySkill: Map<string, FileForReview[]>,
): EstimateInput {
  let fullInputTokens = 0;
  let sampledInputTokens = 0;
  let totalEligibleFiles = 0;

  for (const [, files] of filesBySkill) {
    totalEligibleFiles += files.length;

    // Full: all files
    const fullContent = files
      .map((f) => truncateFileContent(f.content))
      .join("\n\n---\n\n");
    fullInputTokens += SYSTEM_PROMPT_TOKENS + estimateTokens(fullContent);

    // Sampled: top N files by size
    const sampled = [...files]
      .sort((a, b) => b.content.length - a.content.length)
      .slice(0, SAMPLED_FILES_PER_SKILL);
    const sampledContent = sampled
      .map((f) => truncateFileContent(f.content))
      .join("\n\n---\n\n");
    sampledInputTokens += SYSTEM_PROMPT_TOKENS + estimateTokens(sampledContent);
  }

  const skillCount = filesBySkill.size;

  return {
    eligibleFiles: totalEligibleFiles,
    skillCount,
    fullInputTokens,
    fullOutputTokens: skillCount * OUTPUT_TOKENS_PER_SKILL,
    sampledInputTokens,
    sampledOutputTokens: skillCount * OUTPUT_TOKENS_PER_SKILL,
    sampledFilesPerSkill: SAMPLED_FILES_PER_SKILL,
  };
}

export function buildEstimateDisplay(estimate: EstimateInput): string {
  const fullCost = estimateCost(estimate.fullInputTokens, estimate.fullOutputTokens);
  const sampledCost = estimateCost(estimate.sampledInputTokens, estimate.sampledOutputTokens);

  const formatTokens = (n: number) => n >= 1000 ? `~${Math.round(n / 1000)}K` : `${n}`;

  return `
Code Review Token Estimate

  Files eligible: ${estimate.eligibleFiles} (ownership > 50%)
  Skills detected: ${estimate.skillCount}

  [A] Full review
      Input: ${formatTokens(estimate.fullInputTokens)} tokens  Output: ${formatTokens(estimate.fullOutputTokens)} tokens
      Estimated cost: $${fullCost.toFixed(2)}

  [B] Sampled review (${estimate.sampledFilesPerSkill} files/skill)
      Input: ${formatTokens(estimate.sampledInputTokens)} tokens  Output: ${formatTokens(estimate.sampledOutputTokens)} tokens
      Estimated cost: $${sampledCost.toFixed(2)}
`;
}
