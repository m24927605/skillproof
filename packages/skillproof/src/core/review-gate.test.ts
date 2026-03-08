import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideSkillReview } from "./review-gate.ts";

describe("decideSkillReview", () => {
  it("reviews high-value skill with middling static confidence", () => {
    const result = decideSkillReview({
      skill: "TypeScript",
      staticConfidence: 0.5,
      evidenceCount: 5,
      fileEvidenceCount: 3,
      staticReasons: ["3 file(s), 0 snippet(s)"],
    });
    assert.equal(result.shouldReview, true);
    assert.ok(result.priority > 0.5, `priority (${result.priority}) should be > 0.5`);
    assert.ok(result.reason.length > 0);
  });

  it("skips weak dependency-only skill", () => {
    const result = decideSkillReview({
      skill: "Redis",
      staticConfidence: 0.25,
      evidenceCount: 1,
      fileEvidenceCount: 0,
      staticReasons: ["1 dependency(ies), 0 config(s)"],
    });
    assert.equal(result.shouldReview, false);
    assert.ok(result.reason.length > 0);
  });

  it("gives lower priority to strong overdetermined skill than uncertain high-value skill", () => {
    const strong = decideSkillReview({
      skill: "TypeScript",
      staticConfidence: 0.85,
      evidenceCount: 12,
      fileEvidenceCount: 10,
      staticReasons: ["10 file(s)", "3 test file(s)", "CI configured"],
    });
    const uncertain = decideSkillReview({
      skill: "React",
      staticConfidence: 0.5,
      evidenceCount: 4,
      fileEvidenceCount: 3,
      staticReasons: ["3 file(s)"],
    });
    // Both may be reviewed, but uncertain should have higher priority
    assert.ok(uncertain.priority > strong.priority,
      `uncertain (${uncertain.priority}) should have higher priority than strong (${strong.priority})`);
  });

  it("skips skill when evidence is too weak to justify review", () => {
    const result = decideSkillReview({
      skill: "Terraform",
      staticConfidence: 0.15,
      evidenceCount: 1,
      fileEvidenceCount: 0,
      staticReasons: ["Minimal evidence"],
    });
    assert.equal(result.shouldReview, false);
  });

  it("reviews high-value skill even with strong confidence if file evidence exists", () => {
    const result = decideSkillReview({
      skill: "TypeScript",
      staticConfidence: 0.8,
      evidenceCount: 8,
      fileEvidenceCount: 6,
      staticReasons: ["6 file(s)", "2 test file(s)"],
    });
    // High-value skills with file evidence should still be reviewed
    assert.equal(result.shouldReview, true);
  });

  it("skips non-high-value skill with strong confidence and abundant evidence", () => {
    const result = decideSkillReview({
      skill: "GraphQL",
      staticConfidence: 0.8,
      evidenceCount: 10,
      fileEvidenceCount: 8,
      staticReasons: ["8 file(s)", "CI configured"],
    });
    assert.equal(result.shouldReview, false);
  });

  it("returns priority between 0 and 1", () => {
    const cases = [
      { skill: "TypeScript", staticConfidence: 0.1, evidenceCount: 1, fileEvidenceCount: 0, staticReasons: [] as string[] },
      { skill: "Python", staticConfidence: 0.5, evidenceCount: 5, fileEvidenceCount: 3, staticReasons: ["3 file(s)"] },
      { skill: "Redis", staticConfidence: 0.9, evidenceCount: 20, fileEvidenceCount: 15, staticReasons: ["15 file(s)"] },
    ];
    for (const input of cases) {
      const result = decideSkillReview(input);
      assert.ok(result.priority >= 0 && result.priority <= 1,
        `priority for ${input.skill} (${result.priority}) should be in [0, 1]`);
    }
  });
});
