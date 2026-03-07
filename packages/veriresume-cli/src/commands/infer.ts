import { readManifest, writeManifest, getManifestPath } from "../core/manifest.ts";
import { detectSkillEvidence } from "../core/skills.ts";
import type { Claim, Skill } from "../types/manifest.ts";

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

  // 2. List eligible files per skill (ownership > 50%)
  const eligibleFiles = new Map<string, { path: string; ownership: number }[]>();
  for (const [skill, evidences] of skillEvidence) {
    const files = evidences
      .filter((ev) => ev.type === "file" && ev.ownership > 0.5)
      .map((ev) => ({ path: ev.source, ownership: ev.ownership }));
    if (files.length > 0) {
      eligibleFiles.set(skill, files);
    }
  }

  // 3. Write detected skills to manifest (confidence pending LLM review)
  const skills: Skill[] = [...skillEvidence.keys()].map((name) => ({
    name,
    confidence: 0,
    evidence_ids: (skillEvidence.get(name) || []).map((e) => e.id),
    inferred_by: "static" as const,
  }));

  manifest.skills = skills;
  manifest.claims = skills.map((s, i) => ({
    id: `CLAIM-${i + 1}`,
    category: inferCategory(s.name),
    skill: s.name,
    confidence: s.confidence,
    evidence_ids: s.evidence_ids,
  }));

  await writeManifest(manifestPath, manifest);

  // 4. Output summary for Claude Code to review
  console.log(`\nDetected ${skillEvidence.size} skills:`);
  for (const [skill, evidences] of skillEvidence) {
    const files = eligibleFiles.get(skill) || [];
    console.log(`  ${skill}: ${evidences.length} evidence items, ${files.length} eligible files`);
    for (const f of files.slice(0, 5)) {
      console.log(`    - ${f.path} (ownership: ${(f.ownership * 100).toFixed(0)}%)`);
    }
    if (files.length > 5) {
      console.log(`    ... and ${files.length - 5} more`);
    }
  }

  console.log(`\nManifest written with ${skills.length} skills (confidence pending code review).`);
  console.log("Claude Code will now review the code and assign quality scores.");
}
