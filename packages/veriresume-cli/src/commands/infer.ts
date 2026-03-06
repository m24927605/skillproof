import { readManifest, writeManifest, getManifestPath } from "../core/manifest.ts";
import { inferStaticSkills, detectSkillEvidence } from "../core/skills.ts";
import {
  estimateReviewTokens,
  buildEstimateDisplay,
  truncateFileContent,
  type FileForReview,
} from "../core/token-estimate.ts";
import { reviewSkill, type ReviewResult } from "../core/code-review.ts";
import { resolveApiKey } from "../core/config.ts";
import { ask } from "../core/prompt.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Claim } from "../types/manifest.ts";

export async function runInferStatic(manifestPath: string): Promise<void> {
  const manifest = await readManifest(manifestPath);
  const skills = inferStaticSkills(manifest.evidence);

  manifest.skills = skills;
  manifest.claims = skills.map((s, i) => {
    const category = inferCategory(s.name);
    return {
      id: `CLAIM-${i + 1}`,
      category,
      skill: s.name,
      confidence: s.confidence,
      evidence_ids: s.evidence_ids,
    } satisfies Claim;
  });

  await writeManifest(manifestPath, manifest);
  console.log(`Inferred ${skills.length} skills from static signals.`);
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

export async function runInfer(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const manifest = await readManifest(manifestPath);

  // 1. Detect skills from evidence
  const skillEvidence = detectSkillEvidence(manifest.evidence);
  if (skillEvidence.size === 0) {
    console.log("No skills detected from evidence.");
    return;
  }

  // 2. Build file-for-review map: read content, filter by ownership > 0.5
  const filesBySkill = new Map<string, FileForReview[]>();
  for (const [skill, evidences] of skillEvidence) {
    const files: FileForReview[] = [];
    for (const ev of evidences) {
      if (ev.type !== "file") continue;
      if (ev.ownership <= 0.5) continue;
      try {
        const content = await readFile(path.join(cwd, ev.source), "utf8");
        files.push({ path: ev.source, content, ownership: ev.ownership, skill });
      } catch {
        // skip unreadable files
      }
    }
    if (files.length > 0) {
      filesBySkill.set(skill, files);
    }
  }

  if (filesBySkill.size === 0) {
    console.log("No eligible files found for code review (need file evidence with ownership > 50%).");
    // Fall back to static inference
    await runInferStatic(manifestPath);
    return;
  }

  // 3. Estimate tokens and display
  const estimate = estimateReviewTokens(filesBySkill);
  console.log(buildEstimateDisplay(estimate));

  // 4. User chooses mode
  const mode = await ask("Select review mode (A/B): ");
  const isFullReview = mode.trim().toUpperCase() === "A";

  // 5. Resolve API key
  let apiKey = await resolveApiKey(cwd);
  if (!apiKey) {
    console.log("No API key found.");
    apiKey = await ask("Enter your Anthropic API key: ");
    if (!apiKey) {
      throw new Error("API key is required for code review.");
    }
  }

  // 6. Prepare files per skill based on mode
  const SAMPLED_FILES_PER_SKILL = 3;
  const MAX_LINES = 150;
  const reviewResults: ReviewResult[] = [];
  const skills = [...filesBySkill.keys()];

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    let files = filesBySkill.get(skill)!;

    // Apply sampling if mode B
    if (!isFullReview) {
      files = [...files]
        .sort((a, b) => b.content.length - a.content.length)
        .slice(0, SAMPLED_FILES_PER_SKILL);
    }

    // Truncate file contents
    files = files.map((f) => ({
      ...f,
      content: truncateFileContent(f.content, MAX_LINES),
    }));

    console.log(`Reviewing ${i + 1}/${skills.length}: ${skill} (${files.length} files)`);

    try {
      const result = await reviewSkill(apiKey, skill, files);
      reviewResults.push(result);
      console.log(`  Score: ${result.quality_score} — ${result.reasoning.slice(0, 80)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Failed: ${msg}`);
    }
  }

  if (reviewResults.length === 0) {
    console.log("All reviews failed. Falling back to static inference.");
    await runInferStatic(manifestPath);
    return;
  }

  // 7. Map results to skills
  manifest.skills = reviewResults.map((r) => ({
    name: r.skill,
    confidence: r.quality_score,
    evidence_ids: (skillEvidence.get(r.skill) || []).map((e) => e.id),
    inferred_by: "llm" as const,
  }));

  // 8. Build claims
  manifest.claims = manifest.skills.map((s, i) => ({
    id: `CLAIM-${i + 1}`,
    category: inferCategory(s.name),
    skill: s.name,
    confidence: s.confidence,
    evidence_ids: s.evidence_ids,
  }));

  await writeManifest(manifestPath, manifest);

  console.log(`\nCode review complete. ${reviewResults.length} skills reviewed.`);
  for (const r of reviewResults) {
    console.log(`  ${r.skill}: ${r.quality_score} — ${r.strengths.slice(0, 2).join(", ")}`);
  }
}
