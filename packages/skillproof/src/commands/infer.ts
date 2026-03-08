import { readFile } from "node:fs/promises";
import path from "node:path";
import { readManifest, writeManifest, getManifestPath } from "../core/manifest.ts";
import { detectSkillEvidence } from "../core/skills.ts";
import { resolveApiKey } from "../core/config.ts";
import { ask, askYesNo } from "../core/prompt.ts";
import { readConfig, writeConfig } from "../core/config.ts";
import { reviewSkillGroup, reviewSkillGroupFromDigests } from "../core/code-review.ts";
import { computeCacheKey, getCachedReview, saveCachedReview, getCachedGroupReview, saveCachedGroupReview, PROMPT_VERSION, LLM_MODEL } from "../core/review-cache.ts";
import { truncateFileContent, estimateTokens, estimateCost, buildCostPreviewDisplay } from "../core/token-estimate.ts";
import type { CostPreview } from "../core/token-estimate.ts";
import { groupSkillsByFileOverlap } from "../core/skill-grouping.ts";
import type { SkillGroup } from "../core/skill-grouping.ts";
import type { FileForReview } from "../core/token-estimate.ts";
import type { Claim, Evidence, Skill } from "../types/manifest.ts";
import type { ReviewResult } from "../core/code-review.ts";
import { analyzeStaticQuality } from "../core/static-quality.ts";
import { decideSkillReview } from "../core/review-gate.ts";
import { buildEvidenceDigest } from "../core/evidence-digest.ts";
import type { EvidenceDigest } from "../core/evidence-digest.ts";

const TOKEN_BUDGET_PER_SKILL = 50_000;
const MAX_INPUT_TOKENS_PER_REQUEST = 25_000;

interface GroupPlan {
  group: SkillGroup;
  filesToReview: FileForReview[];
  tokenCount: number;
  fileHashes: string[];
  cacheKey: string;
  cached: boolean;
}

export function splitFilesIntoBatches(
  files: FileForReview[],
  maxTokensPerBatch: number = MAX_INPUT_TOKENS_PER_REQUEST,
): FileForReview[][] {
  const batches: FileForReview[][] = [];
  let currentBatch: FileForReview[] = [];
  let currentTokens = 0;

  for (const file of files) {
    const fileTokens = estimateTokens(file.content);

    if (currentBatch.length > 0 && currentTokens + fileTokens > maxTokensPerBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(file);
    currentTokens += fileTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

export function mergeReviewResults(skill: string, reviews: ReviewResult[]): ReviewResult {
  if (reviews.length === 0) {
    return { skill, quality_score: 0, reasoning: "", strengths: [] };
  }

  const averageScore = reviews.reduce((sum, review) => sum + review.quality_score, 0) / reviews.length;
  const reasoning = reviews
    .map((review) => review.reasoning.trim())
    .filter(Boolean)
    .join(" ");
  const strengths = [...new Set(reviews.flatMap((review) => review.strengths.map((strength) => strength.trim()).filter(Boolean)))].slice(0, 4);

  return {
    skill,
    quality_score: Math.round(averageScore * 100) / 100,
    reasoning,
    strengths,
  };
}

/** Merge static and LLM confidence per design doc: 35% static + 65% LLM */
export function mergeHybridConfidence(staticConfidence: number, llmConfidence: number): number {
  return Math.round((staticConfidence * 0.35 + llmConfidence * 0.65) * 100) / 100;
}

/** Build a Skill with hybrid scoring fields */
export function buildHybridSkill(
  name: string,
  evidence: Evidence[],
  review?: ReviewResult,
  cached?: boolean,
): Skill {
  const staticResult = analyzeStaticQuality(name, evidence);
  const staticConf = staticResult.score;

  if (!review) {
    return {
      name,
      confidence: staticConf,
      evidence_ids: evidence.map((e) => e.id),
      inferred_by: "static",
      static_confidence: staticConf,
      review_decision: "static-only",
    };
  }

  const llmConf = review.quality_score;
  const merged = mergeHybridConfidence(staticConf, llmConf);

  return {
    name,
    confidence: merged,
    evidence_ids: evidence.map((e) => e.id),
    inferred_by: "llm",
    strengths: review.strengths,
    reasoning: review.reasoning,
    static_confidence: staticConf,
    llm_confidence: llmConf,
    review_decision: cached ? "cached-llm" : "llm-reviewed",
  };
}

async function reviewGroupWithBatches(
  apiKey: string,
  skills: string[],
  filesToReview: FileForReview[],
): Promise<ReviewResult[]> {
  const batches = splitFilesIntoBatches(filesToReview);
  if (batches.length === 1) {
    return reviewSkillGroup(apiKey, skills, filesToReview);
  }

  const reviewsBySkill = new Map<string, ReviewResult[]>();
  for (const skill of skills) {
    reviewsBySkill.set(skill, []);
  }

  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    const batchTokens = batch.reduce((sum, file) => sum + estimateTokens(file.content), 0);
    console.log(`    Batch ${index + 1}/${batches.length}: ${batch.length} files, ~${Math.round(batchTokens / 1000)}K tokens`);
    const batchReviews = await reviewSkillGroup(apiKey, skills, batch);
    for (const review of batchReviews) {
      reviewsBySkill.get(review.skill)?.push(review);
    }
  }

  return skills.map((skill) => mergeReviewResults(skill, reviewsBySkill.get(skill) ?? []));
}

export function collectFilesForReview(
  allEvidence: Evidence[],
  evidenceIds: string[],
): Evidence[] {
  return allEvidence
    .filter((e) => evidenceIds.includes(e.id) && e.type === "file")
    .sort((a, b) => b.ownership - a.ownership);
}

function inferCategory(skillName: string): Claim["category"] {
  const languages = ["TypeScript", "JavaScript", "Python", "Go", "Rust", "Java"];
  const frameworks = ["React", "Next.js", "Express", "FastAPI", "Vue", "Angular"];
  const infra = ["Docker", "Kubernetes", "Terraform", "AWS", "GCP", "Azure"];
  const tools = ["Redis", "PostgreSQL", "MongoDB", "GraphQL", "GitHub Actions"];

  if (languages.includes(skillName)) return "language";
  if (frameworks.includes(skillName)) return "framework";
  if (infra.includes(skillName)) return "infrastructure";
  if (tools.includes(skillName)) return "tool";
  return "practice";
}

function heuristicConfidence(evidenceItems: Evidence[]): number {
  const fileCount = evidenceItems.filter((e) => e.type === "file").length;
  const commitCount = evidenceItems.filter((e) => e.type === "commit").length;
  const depCount = evidenceItems.filter((e) => e.type === "dependency").length;
  const configCount = evidenceItems.filter((e) => e.type === "config").length;
  const total = evidenceItems.length;

  let score = Math.min(0.3 + total * 0.05, 0.9);
  if (fileCount > 0) score = Math.min(score + 0.1, 0.95);
  if (commitCount > 3) score = Math.min(score + 0.1, 0.95);
  if (configCount > 0) score = Math.min(score + 0.05, 0.95);
  if (depCount > 0 && fileCount === 0 && commitCount === 0) score = Math.min(score, 0.4);
  return Math.round(score * 100) / 100;
}

async function processGroupPlans(
  cwd: string,
  apiKey: string,
  groupPlans: GroupPlan[],
  skillEvidence: Map<string, Evidence[]>,
  skills: Skill[],
  fileContentsCache: Map<string, string>,
  options?: { maxReviewTokens?: number; yes?: boolean },
): Promise<void> {
  const maxTokens = options?.maxReviewTokens ?? 200_000;
  let cumulativeTokens = 0;

  for (const plan of groupPlans) {
    const { group, filesToReview, tokenCount, fileHashes, cacheKey } = plan;
    const groupSkillNames = group.skills;

    if (filesToReview.length === 0) {
      for (const skillName of groupSkillNames) {
        const evs = skillEvidence.get(skillName)!;
        skills.push(buildHybridSkill(skillName, evs));
      }
      continue;
    }

    // Check cache (already computed during pre-compute)
    if (plan.cached) {
      const cachedGroup = await getCachedGroupReview(cwd, cacheKey);
      const cachedMap = new Map(cachedGroup!.map((r) => [r.skill, r]));
      for (const skillName of groupSkillNames) {
        const evs = skillEvidence.get(skillName)!;
        const cached = cachedMap.get(skillName);
        if (cached) {
          console.log(`  ${skillName}: cached — ${cached.quality_score} — ${cached.reasoning}`);
          skills.push(buildHybridSkill(skillName, evs, cached, true));
        } else {
          const individualKey = computeCacheKey(skillName, fileHashes, PROMPT_VERSION, LLM_MODEL);
          const individualCached = await getCachedReview(cwd, individualKey);
          if (individualCached) {
            console.log(`  ${skillName}: cached — ${individualCached.quality_score} — ${individualCached.reasoning}`);
            skills.push(buildHybridSkill(skillName, evs, individualCached, true));
          } else {
            skills.push(buildHybridSkill(skillName, evs));
          }
        }
      }
      continue;
    }

    const skillLabel = groupSkillNames.length > 1
      ? `[${groupSkillNames.join(", ")}]`
      : groupSkillNames[0];

    // Budget check — only for non-cached groups that will call the LLM
    if (cumulativeTokens + tokenCount > maxTokens) {
      if (!options?.yes) {
        console.log(`\n  Budget alert: ${Math.round(cumulativeTokens / 1000)}K / ${Math.round(maxTokens / 1000)}K tokens used.`);
        console.log(`  ${skillLabel} would add ~${Math.round(tokenCount / 1000)}K tokens.`);
        const proceed = await askYesNo("  Continue reviewing?");
        if (!proceed) {
          for (const skillName of groupSkillNames) {
            const evs = skillEvidence.get(skillName)!;
            skills.push(buildHybridSkill(skillName, evs));
          }
          continue;
        }
      } else if (cumulativeTokens + tokenCount > maxTokens) {
        console.log(`  ${skillLabel}: skipped (budget exceeded)`);
        for (const skillName of groupSkillNames) {
          const evs = skillEvidence.get(skillName)!;
          skills.push(buildHybridSkill(skillName, evs));
        }
        continue;
      }
    }

    cumulativeTokens += tokenCount;

    // Build per-skill digests for the group
    const skillDigests = new Map<string, EvidenceDigest>();
    for (const skillName of groupSkillNames) {
      const evs = skillEvidence.get(skillName)!;
      const staticResult = analyzeStaticQuality(skillName, evs);
      const digest = buildEvidenceDigest(skillName, evs, staticResult, fileContentsCache);
      skillDigests.set(skillName, digest);
    }

    console.log(`  Reviewing ${skillLabel}: ${filesToReview.length} files, ~${Math.round(tokenCount / 1000)}K tokens`);

    try {
      const reviews = await reviewSkillGroupFromDigests(apiKey, groupSkillNames, skillDigests);

      if (reviews.length > 0) {
        await saveCachedGroupReview(cwd, cacheKey, reviews);
      }
      for (const review of reviews) {
        const individualKey = computeCacheKey(review.skill, fileHashes, PROMPT_VERSION, LLM_MODEL);
        await saveCachedReview(cwd, individualKey, review);
      }

      const reviewMap = new Map(reviews.map((r) => [r.skill, r]));
      for (const skillName of groupSkillNames) {
        const evs = skillEvidence.get(skillName)!;
        const review = reviewMap.get(skillName);
        if (review) {
          const hybrid = buildHybridSkill(skillName, evs, review);
          console.log(`  ${skillName}: ${hybrid.confidence} (static: ${hybrid.static_confidence}, llm: ${hybrid.llm_confidence}) — ${review.reasoning}`);
          skills.push(hybrid);
        } else {
          console.log(`  ${skillName}: no review returned, falling back to static`);
          skills.push(buildHybridSkill(skillName, evs));
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${skillLabel}: code review failed (${message}), falling back to static`);
      for (const skillName of groupSkillNames) {
        const evs = skillEvidence.get(skillName)!;
        skills.push(buildHybridSkill(skillName, evs));
      }
    }
  }
}

export async function runInfer(cwd: string, options?: { skipLlm?: boolean; maxReviewTokens?: number; yes?: boolean; dryRun?: boolean }): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const manifest = await readManifest(manifestPath);

  // 1. Detect skills from evidence
  const skillEvidence = detectSkillEvidence(manifest.evidence);
  if (skillEvidence.size === 0) {
    console.log("No skills detected from evidence.");
    return;
  }

  // 2. Compute static confidence for ALL skills
  const staticResults = new Map<string, { score: number; reasons: string[] }>();
  for (const [name, evs] of skillEvidence) {
    const result = analyzeStaticQuality(name, evs);
    staticResults.set(name, { score: result.score, reasons: result.reasons });
  }

  // 3. Score skills — hybrid approach
  let skills: Skill[];

  if (options?.skipLlm) {
    skills = [...skillEvidence.entries()].map(([name, evs]) => buildHybridSkill(name, evs));
  } else {
    let apiKey = "";

    if (!options?.dryRun) {
      apiKey = (await resolveApiKey(cwd)) || "";
      if (!apiKey) {
        console.log("Anthropic API key is required for LLM-based skill analysis.");
        apiKey = await ask("Enter your Anthropic API key: ");
        if (!apiKey) {
          console.error("Error: Anthropic API key is required. Cannot infer skills without LLM analysis.");
          process.exitCode = 1;
          return;
        }
        const save = await askYesNo("Save to .skillproof/config.json for future use?");
        if (save) {
          const config = await readConfig(cwd);
          config.anthropic_api_key = apiKey;
          await writeConfig(cwd, config);
          console.log("Key saved.");
        }
      }
    }

    console.log(`\nAnalyzing ${skillEvidence.size} skills...`);

    skills = [];

    // First pass: collect file paths, apply review gating
    const skillFilePaths = new Map<string, string[]>();
    const staticOnlySkills: string[] = [];

    for (const [name, evs] of skillEvidence) {
      const fileEvidence = collectFilesForReview(manifest.evidence, evs.map((e) => e.id));
      const staticInfo = staticResults.get(name)!;

      // Apply review gating
      const gateResult = decideSkillReview({
        skill: name,
        staticConfidence: staticInfo.score,
        evidenceCount: evs.length,
        fileEvidenceCount: fileEvidence.length,
        staticReasons: staticInfo.reasons,
      });

      if (!gateResult.shouldReview) {
        staticOnlySkills.push(name);
        console.log(`  ${name}: static-only (${gateResult.reason})`);
      } else {
        skillFilePaths.set(name, fileEvidence.map((e) => e.source));
      }
    }

    // Add static-only skills
    for (const name of staticOnlySkills) {
      const evs = skillEvidence.get(name)!;
      skills.push(buildHybridSkill(name, evs));
    }

    console.log(`\n  Static-only: ${staticOnlySkills.length} skills`);
    console.log(`  Selected for LLM review: ${skillFilePaths.size} skills`);

    if (skillFilePaths.size > 0) {
      // Group skills by file overlap
      const groups = groupSkillsByFileOverlap(skillFilePaths);

      // Sort groups by review priority descending
      const sortedGroups = [...groups].sort((a, b) => {
        const priorityA = Math.max(...a.skills.map((s) => {
          const info = staticResults.get(s)!;
          return decideSkillReview({
            skill: s,
            staticConfidence: info.score,
            evidenceCount: skillEvidence.get(s)!.length,
            fileEvidenceCount: collectFilesForReview(manifest.evidence, skillEvidence.get(s)!.map((e) => e.id)).length,
            staticReasons: info.reasons,
          }).priority;
        }));
        const priorityB = Math.max(...b.skills.map((s) => {
          const info = staticResults.get(s)!;
          return decideSkillReview({
            skill: s,
            staticConfidence: info.score,
            evidenceCount: skillEvidence.get(s)!.length,
            fileEvidenceCount: collectFilesForReview(manifest.evidence, skillEvidence.get(s)!.map((e) => e.id)).length,
            staticReasons: info.reasons,
          }).priority;
        }));
        return priorityB - priorityA;
      });

      // Pre-compute: collect files and check cache for each group
      const groupPlans: GroupPlan[] = [];
      const fileContentsCache = new Map<string, string>();

      for (const group of sortedGroups) {
        const groupSkillNames = group.skills;
        const groupCacheKeyName = [...groupSkillNames].sort().join("+");

        // Collect unique files for the group, respecting token budget
        const allFileEvidence = new Map<string, Evidence>();
        for (const skillName of groupSkillNames) {
          const evs = skillEvidence.get(skillName)!;
          const fileEvs = collectFilesForReview(manifest.evidence, evs.map((e) => e.id));
          for (const ev of fileEvs) {
            if (!allFileEvidence.has(ev.source)) {
              allFileEvidence.set(ev.source, ev);
            }
          }
        }

        // Sort by ownership descending and read files up to token budget
        const sortedEvidence = [...allFileEvidence.values()].sort((a, b) => b.ownership - a.ownership);
        const filesToReview: FileForReview[] = [];
        let tokenCount = 0;
        const budgetPerGroup = TOKEN_BUDGET_PER_SKILL * groupSkillNames.length;

        for (const ev of sortedEvidence) {
          const filePath = path.join(cwd, ev.source);
          let content: string;
          try {
            content = await readFile(filePath, "utf-8");
          } catch {
            continue;
          }
          const truncated = truncateFileContent(content);
          const tokens = estimateTokens(truncated);
          if (tokenCount + tokens > budgetPerGroup && filesToReview.length > 0) {
            break;
          }
          filesToReview.push({ path: ev.source, content: truncated, ownership: ev.ownership, skill: groupSkillNames[0] });
          fileContentsCache.set(ev.source, truncated);
          tokenCount += tokens;
        }

        // Check cache using combined key
        const fileHashes = sortedEvidence
          .filter((ev) => filesToReview.some((f) => f.path === ev.source))
          .map((ev) => ev.hash);
        const cacheKey = computeCacheKey(groupCacheKeyName, fileHashes, PROMPT_VERSION, LLM_MODEL);
        const cachedGroup = await getCachedGroupReview(cwd, cacheKey);

        groupPlans.push({
          group,
          filesToReview,
          tokenCount,
          fileHashes,
          cacheKey,
          cached: !!(cachedGroup && cachedGroup.length > 0),
        });
      }

      // Build and display cost preview
      const OUTPUT_TOKENS_PER_SKILL = 200;
      const totalGroups = groupPlans.filter(p => p.filesToReview.length > 0).length;
      const cachedGroups = groupPlans.filter(p => p.cached).length;
      const totalInputTokens = groupPlans.reduce((sum, p) => sum + p.tokenCount, 0);
      const actualInputTokens = groupPlans.filter(p => !p.cached).reduce((sum, p) => sum + p.tokenCount, 0);
      const totalSkillCount = groupPlans.reduce((sum, p) => sum + p.group.skills.length, 0);
      const cachedSkillCount = groupPlans.filter(p => p.cached).reduce((sum, p) => sum + p.group.skills.length, 0);
      const totalOutputTokens = totalSkillCount * OUTPUT_TOKENS_PER_SKILL;
      const actualOutputTokens = (totalSkillCount - cachedSkillCount) * OUTPUT_TOKENS_PER_SKILL;
      const totalCost = estimateCost(totalInputTokens, totalOutputTokens);
      const actualCost = estimateCost(actualInputTokens, actualOutputTokens);

      const preview: CostPreview = {
        totalGroups, cachedGroups,
        totalInputTokens, actualInputTokens,
        totalOutputTokens, actualOutputTokens,
        totalCost, actualCost,
      };

      console.log(buildCostPreviewDisplay(preview));

      if (options?.dryRun) {
        console.log("\n  Dry run — no LLM calls made.");
        for (const plan of groupPlans) {
          for (const skillName of plan.group.skills) {
            const evs = skillEvidence.get(skillName)!;
            skills.push(buildHybridSkill(skillName, evs));
          }
        }
      } else {
        if (!options?.yes && actualCost > 0) {
          const proceed = await askYesNo("Proceed with code review?");
          if (!proceed) {
            console.log("Skipping LLM review. Using static scores.");
            for (const plan of groupPlans) {
              for (const skillName of plan.group.skills) {
                const evs = skillEvidence.get(skillName)!;
                skills.push(buildHybridSkill(skillName, evs));
              }
            }
          } else {
            await processGroupPlans(cwd, apiKey, groupPlans, skillEvidence, skills, fileContentsCache, options);
          }
        } else {
          await processGroupPlans(cwd, apiKey, groupPlans, skillEvidence, skills, fileContentsCache, options);
        }
      }
    }
  }

  if (!options?.dryRun) {
    // 4. Write to manifest
    manifest.skills = skills;
    manifest.claims = skills.map((s, i) => ({
      id: `CLAIM-${i + 1}`,
      category: inferCategory(s.name),
      skill: s.name,
      confidence: s.confidence,
      evidence_ids: s.evidence_ids,
    }));

    await writeManifest(manifestPath, manifest);
  }

  // 5. Output summary
  console.log(`\nSkill Assessment Results:`);
  console.log("========================");
  for (const s of [...skills].sort((a, b) => b.confidence - a.confidence)) {
    const level = s.confidence >= 0.9 ? "Expert" : s.confidence >= 0.7 ? "Proficient" : s.confidence >= 0.5 ? "Familiar" : "Beginner";
    const decision = s.review_decision ?? "unknown";
    console.log(`  ${s.name}: ${s.confidence} (${level}) [${s.inferred_by}] [${decision}]`);
  }
  const staticCount = skills.filter(s => s.review_decision === "static-only").length;
  const reviewedCount = skills.filter(s => s.review_decision === "llm-reviewed").length;
  const cachedCount = skills.filter(s => s.review_decision === "cached-llm").length;
  console.log(`\nTotal skills: ${skills.length} (static: ${staticCount}, reviewed: ${reviewedCount}, cached: ${cachedCount})`);
  console.log(`Total claims: ${skills.length}`);
}
