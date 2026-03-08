import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deduplicateRepos, parseRepoListJson } from "./github.ts";

describe("github", () => {
  describe("parseRepoListJson", () => {
    it("parses gh repo list JSON output", () => {
      const json = JSON.stringify([
        { name: "repo-a", url: "https://github.com/user/repo-a", owner: { login: "user" } },
        { name: "repo-b", url: "https://github.com/user/repo-b", owner: { login: "user" } },
      ]);
      const repos = parseRepoListJson(json);
      assert.equal(repos.length, 2);
      assert.equal(repos[0].name, "repo-a");
      assert.equal(repos[0].cloneUrl, "https://github.com/user/repo-a");
    });

    it("returns empty array for empty input", () => {
      assert.deepEqual(parseRepoListJson("[]"), []);
    });
  });

  describe("deduplicateRepos", () => {
    it("removes duplicate repos by clone URL", () => {
      const repos = [
        { name: "repo-a", cloneUrl: "https://github.com/user/repo-a", source: "my repos" },
        { name: "repo-a", cloneUrl: "https://github.com/user/repo-a", source: "contributed" },
        { name: "repo-b", cloneUrl: "https://github.com/user/repo-b", source: "my repos" },
      ];
      const result = deduplicateRepos(repos);
      assert.equal(result.length, 2);
    });
  });
});
