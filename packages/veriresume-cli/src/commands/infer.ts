import Anthropic from "@anthropic-ai/sdk";
import { readManifest, writeManifest, getManifestPath } from "../core/manifest.ts";
import { detectSkillEvidence } from "../core/skills.ts";
import { resolveApiKey } from "../core/config.ts";
import { ask, askYesNo } from "../core/prompt.ts";
import { readConfig, writeConfig } from "../core/config.ts";
import type { Claim, Evidence, Skill } from "../types/manifest.ts";

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

function buildSkillSummary(
  skillName: string,
  evidenceIds: string[],
  allEvidence: Evidence[],
): string {
  const evidenceItems = allEvidence.filter((e) => evidenceIds.includes(e.id));

  const byType: Record<string, Evidence[]> = {};
  for (const e of evidenceItems) {
    byType[e.type] = byType[e.type] || [];
    byType[e.type].push(e);
  }

  const lines = [`Skill: ${skillName}`, `Evidence count: ${evidenceItems.length}`];

  if (byType.file) {
    lines.push(`Files (${byType.file.length}): ${byType.file.map((e) => `${e.source} (ownership: ${e.ownership})`).join(", ")}`);
  }
  if (byType.commit) {
    lines.push(`Commits (${byType.commit.length}): ${byType.commit.slice(0, 5).map((e) => (e.metadata?.message as string) || e.source).join("; ")}`);
  }
  if (byType.dependency) {
    lines.push(`Dependencies (${byType.dependency.length}): ${byType.dependency.map((e) => e.source).join(", ")}`);
  }
  if (byType.config) {
    lines.push(`Config files (${byType.config.length}): ${byType.config.map((e) => e.source).join(", ")}`);
  }
  if (byType.pull_request) {
    lines.push(`Pull Requests (${byType.pull_request.length})`);
  }

  return lines.join("\n");
}

async function scoreSkillsWithLLM(
  apiKey: string,
  skillEvidence: Map<string, Evidence[]>,
  allEvidence: Evidence[],
): Promise<Record<string, number>> {
  const skillSummaries = [...skillEvidence.entries()]
    .map(([name, evs]) => buildSkillSummary(name, evs.map((e) => e.id), allEvidence))
    .join("\n\n---\n\n");

  const prompt = `You are evaluating a software developer's skill proficiency based on code repository evidence.

For each skill below, assess the developer's confidence score from 0.0 to 1.0 based on:
- Number and quality of evidence items (files, commits, dependencies, configs)
- File ownership percentage (higher ownership = stronger evidence)
- Breadth of usage (multiple repos, different contexts)
- Depth indicators (config files, test files, CI/CD integration suggest deeper knowledge)

Scoring guide:
- 0.9-1.0: Expert - extensive evidence, high ownership, production-grade usage across repos
- 0.7-0.89: Proficient - solid evidence, good ownership, meaningful usage
- 0.5-0.69: Familiar - some evidence, moderate usage
- 0.3-0.49: Basic - minimal evidence, dependency-only or trivial usage
- 0.0-0.29: Negligible - near-zero evidence

IMPORTANT: Be critical. Dependency-only evidence (no authored files) should score lower. Config-only evidence without implementation files should also score lower.

Here are the skills and their evidence:

${skillSummaries}

Respond ONLY with a JSON object mapping skill names to confidence scores. Example:
{"Docker": 0.85, "Python": 0.8}

No explanation, no markdown fences, just the JSON object.`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude API");
  }

  const cleaned = textBlock.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned) as Record<string, number>;
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

    console.log(`\nAnalyzing ${skillEvidence.size} skills with LLM...`);
    const scores = await scoreSkillsWithLLM(apiKey, skillEvidence, manifest.evidence);
    console.log("\nLLM Confidence Scores:");
    console.log(JSON.stringify(scores, null, 2));

    skills = [...skillEvidence.entries()].map(([name, evs]) => ({
      name,
      confidence: typeof scores[name] === "number" ? scores[name] : 0.5,
      evidence_ids: evs.map((e) => e.id),
      inferred_by: "llm" as const,
    }));
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
