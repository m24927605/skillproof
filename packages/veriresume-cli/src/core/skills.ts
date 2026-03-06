import type { Evidence, Skill } from "../types/manifest.js";

interface SignalRule {
  skill: string;
  match: (ev: Evidence) => boolean;
  confidence: number;
}

const SIGNAL_RULES: SignalRule[] = [
  // Infrastructure
  { skill: "Docker", match: (ev) => /dockerfile/i.test(ev.source) || /docker-compose/i.test(ev.source), confidence: 0.85 },
  { skill: "Kubernetes", match: (ev) => /helm/i.test(ev.source) || /k8s/i.test(ev.source), confidence: 0.80 },
  { skill: "Terraform", match: (ev) => /\.tf$/.test(ev.source) || ev.id === "EV-DEP-terraform", confidence: 0.80 },
  { skill: "GitHub Actions", match: (ev) => ev.source.includes(".github/workflows/"), confidence: 0.75 },

  // Cloud
  { skill: "AWS", match: (ev) => /aws-sdk|@aws-sdk/i.test(ev.id) || /aws/i.test(ev.source), confidence: 0.75 },

  // Databases & caches
  { skill: "Redis", match: (ev) => /redis/i.test(ev.id) || /redis/i.test(ev.source), confidence: 0.80 },
  { skill: "PostgreSQL", match: (ev) => /pg|postgres|sequelize|prisma|typeorm/i.test(ev.id), confidence: 0.75 },
  { skill: "MongoDB", match: (ev) => /mongo|mongoose/i.test(ev.id), confidence: 0.75 },

  // Languages (by file extension)
  { skill: "TypeScript", match: (ev) => ev.type === "file" && /\.tsx?$/.test(ev.source), confidence: 0.90 },
  { skill: "JavaScript", match: (ev) => ev.type === "file" && /\.jsx?$/.test(ev.source), confidence: 0.90 },
  { skill: "Python", match: (ev) => ev.type === "file" && /\.py$/.test(ev.source), confidence: 0.90 },
  { skill: "Go", match: (ev) => ev.type === "file" && /\.go$/.test(ev.source), confidence: 0.90 },
  { skill: "Rust", match: (ev) => ev.type === "file" && /\.rs$/.test(ev.source), confidence: 0.90 },
  { skill: "Java", match: (ev) => ev.type === "file" && /\.java$/.test(ev.source), confidence: 0.90 },

  // Frameworks
  { skill: "React", match: (ev) => /react/i.test(ev.id) || (ev.type === "file" && /\.tsx$/.test(ev.source)), confidence: 0.80 },
  { skill: "Next.js", match: (ev) => /next/i.test(ev.id) || ev.source === "next.config.js" || ev.source === "next.config.mjs", confidence: 0.80 },
  { skill: "Express", match: (ev) => /express/i.test(ev.id), confidence: 0.80 },
  { skill: "FastAPI", match: (ev) => /fastapi/i.test(ev.id), confidence: 0.80 },

  // Tools
  { skill: "GraphQL", match: (ev) => /graphql|apollo/i.test(ev.id) || /\.graphql$/.test(ev.source), confidence: 0.80 },

  // Practices (from PR evidence)
  { skill: "Code Review", match: (ev) => ev.type === "pull_request", confidence: 0.75 },
  { skill: "Collaboration", match: (ev) => ev.type === "pull_request", confidence: 0.70 },
];

export function inferStaticSkills(evidence: Evidence[]): Skill[] {
  const skillMap = new Map<string, { confidence: number; evidenceIds: string[] }>();

  for (const ev of evidence) {
    for (const rule of SIGNAL_RULES) {
      if (rule.match(ev)) {
        const existing = skillMap.get(rule.skill);
        if (existing) {
          existing.evidenceIds.push(ev.id);
          existing.confidence = Math.min(
            1.0,
            existing.confidence + 0.02 * (existing.evidenceIds.length - 1),
          );
        } else {
          skillMap.set(rule.skill, {
            confidence: rule.confidence,
            evidenceIds: [ev.id],
          });
        }
      }
    }
  }

  return Array.from(skillMap.entries()).map(([name, data]) => ({
    name,
    confidence: Math.round(data.confidence * 100) / 100,
    evidence_ids: data.evidenceIds,
    inferred_by: "static" as const,
  }));
}
