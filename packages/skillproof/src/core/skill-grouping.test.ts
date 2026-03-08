import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupSkillsByFileOverlap } from "./skill-grouping.ts";

describe("skill-grouping", () => {
  it("groups skills with >= 50% file overlap", () => {
    const skillFiles = new Map<string, string[]>();
    skillFiles.set("TypeScript", ["a.tsx", "b.ts", "c.tsx"]);
    skillFiles.set("React", ["a.tsx", "c.tsx", "d.tsx"]);
    skillFiles.set("Docker", ["Dockerfile"]);

    const groups = groupSkillsByFileOverlap(skillFiles, 0.5);
    assert.equal(groups.length, 2);

    const tsReactGroup = groups.find((g) => g.skills.includes("TypeScript"));
    assert.ok(tsReactGroup);
    assert.ok(tsReactGroup.skills.includes("React"));

    const dockerGroup = groups.find((g) => g.skills.includes("Docker"));
    assert.ok(dockerGroup);
    assert.equal(dockerGroup.skills.length, 1);
  });

  it("keeps all skills independent when no overlap", () => {
    const skillFiles = new Map<string, string[]>();
    skillFiles.set("Python", ["app.py"]);
    skillFiles.set("Go", ["main.go"]);

    const groups = groupSkillsByFileOverlap(skillFiles, 0.5);
    assert.equal(groups.length, 2);
  });

  it("deduplicates files in merged groups", () => {
    const skillFiles = new Map<string, string[]>();
    skillFiles.set("TypeScript", ["a.tsx", "b.tsx"]);
    skillFiles.set("React", ["a.tsx", "b.tsx"]);

    const groups = groupSkillsByFileOverlap(skillFiles, 0.5);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].files.length, 2);
  });
});
