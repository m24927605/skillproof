export interface SkillGroup {
  skills: string[];
  files: string[];
}

export function groupSkillsByFileOverlap(
  skillFiles: Map<string, string[]>,
  threshold: number = 0.5,
): SkillGroup[] {
  const skills = [...skillFiles.keys()];
  const assigned = new Set<string>();
  const groups: SkillGroup[] = [];

  for (let i = 0; i < skills.length; i++) {
    if (assigned.has(skills[i])) continue;

    const group: string[] = [skills[i]];
    assigned.add(skills[i]);
    const filesA = new Set(skillFiles.get(skills[i])!);

    for (let j = i + 1; j < skills.length; j++) {
      if (assigned.has(skills[j])) continue;

      const filesB = new Set(skillFiles.get(skills[j])!);
      const intersection = [...filesA].filter((f) => filesB.has(f)).length;
      const overlapA = intersection / filesA.size;
      const overlapB = intersection / filesB.size;

      if (overlapA >= threshold || overlapB >= threshold) {
        group.push(skills[j]);
        assigned.add(skills[j]);
        for (const f of filesB) filesA.add(f);
      }
    }

    const mergedFiles = [...new Set(group.flatMap((s) => skillFiles.get(s)!))];
    groups.push({ skills: group, files: mergedFiles });
  }

  return groups;
}
