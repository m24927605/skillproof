import { readManifest, writeManifest, getManifestPath } from "../core/manifest.ts";
import { inferStaticSkills } from "../core/skills.ts";
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
  await runInferStatic(manifestPath);
}
