import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deduplicateEmails, mergeEmailSources } from "./identity.ts";

describe("identity", () => {
  describe("deduplicateEmails", () => {
    it("removes duplicate emails case-insensitively", () => {
      const result = deduplicateEmails([
        { email: "alice@test.com", sources: ["git config"] },
        { email: "Alice@test.com", sources: ["github"] },
        { email: "bob@test.com", sources: ["git log"] },
      ]);
      assert.equal(result.length, 2);
      const alice = result.find((e) => e.email.toLowerCase() === "alice@test.com");
      assert.ok(alice);
      assert.ok(alice.sources.includes("git config"));
      assert.ok(alice.sources.includes("github"));
    });

    it("returns empty array for empty input", () => {
      assert.deepEqual(deduplicateEmails([]), []);
    });
  });

  describe("mergeEmailSources", () => {
    it("merges emails from multiple sources", () => {
      const gitConfig = [{ email: "alice@test.com", sources: ["git config"] }];
      const github = [
        { email: "alice@test.com", sources: ["github"] },
        { email: "alice-work@company.com", sources: ["github"] },
      ];
      const gitLog = [
        { email: "alice@test.com", sources: ["git log: repo-a"] },
        { email: "noreply@github.com", sources: ["git log: repo-a"] },
      ];

      const result = mergeEmailSources([gitConfig, github, gitLog]);
      assert.equal(result.length, 3);

      const alice = result.find((e) => e.email === "alice@test.com");
      assert.ok(alice);
      assert.ok(alice.sources.length >= 3);
    });
  });
});
