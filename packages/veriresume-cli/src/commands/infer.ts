import { readFile } from "node:fs/promises";
import path from "node:path";
import { readManifest, writeManifest, getManifestPath } from "../core/manifest.ts";
import { detectSkillEvidence } from "../core/skills.ts";
import { resolveApiKey } from "../core/config.ts";
import { ask, askYesNo } from "../core/prompt.ts";
import { readConfig, writeConfig } from "../core/config.ts";
import { reviewSkill } from "../core/code-review.ts";
import { truncateFileContent, estimateTokens } from "../core/token-estimate.ts";
import type { FileForReview } from "../core/token-estimate.ts";
import type { Claim, Evidence, Skill } from "../types/manifest.ts";

const TOKEN_BUDGET_PER_SKILL = 50_000;

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

export async function runInfer(cwd: string, options?: { skipLlm?: boolean }): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const manifest = await readManifest(manifestPath);

  // 1. Detect skills from evidence
  const skillEvidence = detectSkillEvidence(manifest.evidence);
  if (skillEvidence.size === 0) {
    console.log("No skills detected from evidence.");
    return;
  }

  // 2. Score skills — LLM required unless skipLlm (tests only)
  let skills: Skill[];

  if (options?.skipLlm) {
    skills = [...skillEvidence.entries()].map(([name, evs]) => ({
      name,
      confidence: heuristicConfidence(evs),
      evidence_ids: evs.map((e) => e.id),
      inferred_by: "static" as const,
    }));
  } else {
    let apiKey = await resolveApiKey(cwd);
    if (!apiKey) {
      console.log("Anthropic API key is required for LLM-based skill analysis.");
      apiKey = await ask("Enter your Anthropic API key: ");
      if (!apiKey) {
        console.error("Error: Anthropic API key is required. Cannot infer skills without LLM analysis.");
        process.exitCode = 1;
        return;
      }
      const save = await askYesNo("Save to .veriresume/config.json for future use?");
      if (save) {
        const config = await readConfig(cwd);
        config.anthropic_api_key = apiKey;
        await writeConfig(cwd, config);
        console.log("Key saved.");
      }
    }

    console.log(`\nAnalyzing ${skillEvidence.size} skills with code review...`);

    skills = [];
    for (const [name, evs] of skillEvidence) {
      const fileEvidence = collectFilesForReview(manifest.evidence, evs.map((e) => e.id));

      if (fileEvidence.length === 0) {
        // No files to review — use heuristic
        skills.push({
          name,
          confidence: heuristicConfidence(evs),
          evidence_ids: evs.map((e) => e.id),
          inferred_by: "static" as const,
        });
        continue;
      }

      // Read file contents, sorted by ownership, up to token budget
      const filesToReview: FileForReview[] = [];
      let tokenCount = 0;
      for (const ev of fileEvidence) {
        const filePath = path.join(cwd, ev.source);
        let content: string;
        try {
          content = await readFile(filePath, "utf-8");
        } catch {
          continue; // file may not exist (e.g., deleted)
        }
        const truncated = truncateFileContent(content);
        const tokens = estimateTokens(truncated);
        if (tokenCount + tokens > TOKEN_BUDGET_PER_SKILL && filesToReview.length > 0) {
          break;
        }
        filesToReview.push({ path: ev.source, content: truncated, ownership: ev.ownership, skill: name });
        tokenCount += tokens;
      }

      if (filesToReview.length === 0) {
        skills.push({
          name,
          confidence: heuristicConfidence(evs),
          evidence_ids: evs.map((e) => e.id),
          inferred_by: "static" as const,
        });
        continue;
      }

      console.log(`  Reviewing ${name}: ${filesToReview.length} files, ~${Math.round(tokenCount / 1000)}K tokens`);
      try {
        const review = await reviewSkill(apiKey, name, filesToReview);
        console.log(`  ${name}: ${review.quality_score} — ${review.reasoning}`);

        skills.push({
          name,
          confidence: review.quality_score,
          evidence_ids: evs.map((e) => e.id),
          inferred_by: "llm" as const,
          strengths: review.strengths,
          reasoning: review.reasoning,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`  ${name}: code review failed (${message}), falling back to heuristic`);
        skills.push({
          name,
          confidence: heuristicConfidence(evs),
          evidence_ids: evs.map((e) => e.id),
          inferred_by: "static" as const,
        });
      }
    }
  }

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

  // 5. Output summary
  console.log(`\nSkill Assessment Results:`);
  console.log("========================");
  for (const s of [...skills].sort((a, b) => b.confidence - a.confidence)) {
    const level = s.confidence >= 0.9 ? "Expert" : s.confidence >= 0.7 ? "Proficient" : s.confidence >= 0.5 ? "Familiar" : "Beginner";
    console.log(`  ${s.name}: ${s.confidence} (${level}) [${s.inferred_by}]`);
  }
  console.log(`\nTotal skills: ${skills.length}`);
  console.log(`Total claims: ${manifest.claims.length}`);
}
