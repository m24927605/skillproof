import type { Evidence, Skill, Manifest, RepoEntry } from "../types/manifest.ts";

export function prefixEvidence(evidence: Evidence[], repoName: string): Evidence[] {
  return evidence.map((e) => ({
    ...e,
    id: `${repoName}:${e.id}`,
    source: `${repoName}/${e.source}`,
  }));
}

export function mergeSkills(skills: Skill[]): Skill[] {
  const map = new Map<string, Skill>();
  for (const skill of skills) {
    const existing = map.get(skill.name);
    if (existing) {
      if (skill.confidence > existing.confidence) {
        existing.confidence = skill.confidence;
      }
      existing.evidence_ids.push(...skill.evidence_ids);
    } else {
      map.set(skill.name, {
        ...skill,
        evidence_ids: [...skill.evidence_ids],
      });
    }
  }
  return [...map.values()];
}

export function mergeManifests(
  entries: { manifest: Manifest; repoName: string }[]
): Manifest {
  if (entries.length === 0) {
    throw new Error("mergeManifests requires at least one entry");
  }
  const allEvidence: Evidence[] = [];
  const allSkills: Skill[] = [];
  const repos: RepoEntry[] = [];

  for (const { manifest, repoName } of entries) {
    allEvidence.push(...prefixEvidence(manifest.evidence, repoName));

    const prefixedSkills = manifest.skills.map((s) => ({
      ...s,
      evidence_ids: s.evidence_ids.map((id) => `${repoName}:${id}`),
    }));
    allSkills.push(...prefixedSkills);

    repos.push({
      url: manifest.repo.url,
      head_commit: manifest.repo.head_commit,
      name: repoName,
    });
  }

  const firstManifest = entries[0].manifest;

  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    repo: firstManifest.repo,
    author: firstManifest.author,
    evidence: allEvidence,
    skills: mergeSkills(allSkills),
    claims: [],
    signatures: [],
    repos,
  };
}
