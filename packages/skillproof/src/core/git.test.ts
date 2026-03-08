import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGitLog, parseBlameOutput, parseGitHubPRs, parseRepoFromRemote } from "./git.ts";
import type { GitCommit } from "./git.ts";

describe("git", () => {
  describe("parseGitLog", () => {
    it("parses a single commit line", () => {
      const raw = "abc1234|John Doe|john@example.com|2025-01-15T10:30:00Z|feat: add login";
      const commits = parseGitLog(raw);
      assert.equal(commits.length, 1);
      assert.deepEqual(commits[0], {
        hash: "abc1234",
        author: "John Doe",
        email: "john@example.com",
        date: "2025-01-15T10:30:00Z",
        message: "feat: add login",
      });
    });

    it("parses multiple commits", () => {
      const raw = [
        "abc1234|John|john@ex.com|2025-01-15T10:00:00Z|feat: add A",
        "def5678|John|john@ex.com|2025-01-16T10:00:00Z|fix: fix B",
      ].join("\n");
      const commits = parseGitLog(raw);
      assert.equal(commits.length, 2);
    });

    it("handles empty input", () => {
      assert.deepEqual(parseGitLog(""), []);
      assert.deepEqual(parseGitLog("\n"), []);
    });
  });

  describe("parseBlameOutput", () => {
    it("calculates ownership from blame output", () => {
      const blame = [
        "abc1234 1 1 1",
        "author John",
        "author-mail <john@example.com>",
        "author-time 1700000000",
        "author-tz +0000",
        "committer John",
        "committer-mail <john@example.com>",
        "committer-time 1700000000",
        "committer-tz +0000",
        "summary feat: add login",
        "filename src/index.ts",
        "\tconst x = 1;",
        "def5678 2 2 1",
        "author Jane",
        "author-mail <jane@example.com>",
        "author-time 1700000001",
        "author-tz +0000",
        "committer Jane",
        "committer-mail <jane@example.com>",
        "committer-time 1700000001",
        "committer-tz +0000",
        "summary fix: typo",
        "filename src/index.ts",
        "\tconst y = 2;",
      ].join("\n");

      const ownership = parseBlameOutput(blame, "john@example.com");
      assert.equal(ownership, 0.5);
    });

    it("returns 0 when author has no lines", () => {
      const blame = [
        "abc1234 1 1 1",
        "author Jane",
        "author-mail <jane@example.com>",
        "author-time 1700000000",
        "author-tz +0000",
        "committer Jane",
        "committer-mail <jane@example.com>",
        "committer-time 1700000000",
        "committer-tz +0000",
        "summary init",
        "filename src/index.ts",
        "\tline 1",
      ].join("\n");

      const ownership = parseBlameOutput(blame, "john@example.com");
      assert.equal(ownership, 0);
    });

    it("returns 1 when author owns all lines", () => {
      const blame = [
        "abc1234 1 1 1",
        "author John",
        "author-mail <john@example.com>",
        "author-time 1700000000",
        "author-tz +0000",
        "committer John",
        "committer-mail <john@example.com>",
        "committer-time 1700000000",
        "committer-tz +0000",
        "summary init",
        "filename src/index.ts",
        "\tline 1",
      ].join("\n");

      const ownership = parseBlameOutput(blame, "john@example.com");
      assert.equal(ownership, 1);
    });
  });

  describe("parseRepoFromRemote", () => {
    it("parses HTTPS remote URL", () => {
      const result = parseRepoFromRemote("https://github.com/owner/repo.git");
      assert.deepEqual(result, { owner: "owner", repo: "repo" });
    });

    it("parses SSH remote URL", () => {
      const result = parseRepoFromRemote("git@github.com:owner/repo.git");
      assert.deepEqual(result, { owner: "owner", repo: "repo" });
    });

    it("returns null for non-GitHub URL", () => {
      const result = parseRepoFromRemote("https://gitlab.com/owner/repo.git");
      assert.equal(result, null);
    });
  });

  describe("parseGitHubPRs", () => {
    it("parses gh api JSON output and filters to merged only", () => {
      const json = JSON.stringify([
        {
          number: 42,
          title: "feat: add auth",
          state: "closed",
          merged_at: "2025-06-15T10:00:00Z",
          html_url: "https://github.com/owner/repo/pull/42",
          additions: 150,
          deletions: 20,
          user: { login: "john" },
        },
        {
          number: 43,
          title: "docs: update readme",
          state: "closed",
          merged_at: null,
          html_url: "https://github.com/owner/repo/pull/43",
          additions: 10,
          deletions: 5,
          user: { login: "john" },
        },
      ]);

      const prs = parseGitHubPRs(json);
      assert.equal(prs.length, 1);
      assert.equal(prs[0].number, 42);
      assert.equal(prs[0].title, "feat: add auth");
      assert.equal(prs[0].mergedAt, "2025-06-15T10:00:00Z");
      assert.equal(prs[0].additions, 150);
    });

    it("filters by author login when provided", () => {
      const json = JSON.stringify([
        { number: 1, title: "my PR", merged_at: "2025-06-15T10:00:00Z", html_url: "https://github.com/o/r/pull/1", additions: 10, deletions: 5, user: { login: "john" } },
        { number: 2, title: "someone else", merged_at: "2025-06-16T10:00:00Z", html_url: "https://github.com/o/r/pull/2", additions: 20, deletions: 3, user: { login: "jane" } },
      ]);
      const prs = parseGitHubPRs(json, "john");
      assert.equal(prs.length, 1);
      assert.equal(prs[0].number, 1);
    });

    it("returns all merged PRs when no author filter", () => {
      const json = JSON.stringify([
        { number: 1, title: "a", merged_at: "2025-06-15T10:00:00Z", html_url: "url1", additions: 10, deletions: 5, user: { login: "john" } },
        { number: 2, title: "b", merged_at: "2025-06-16T10:00:00Z", html_url: "url2", additions: 20, deletions: 3, user: { login: "jane" } },
      ]);
      const prs = parseGitHubPRs(json);
      assert.equal(prs.length, 2);
    });
  });

  describe("parseRepoFromRemote – dotted names", () => {
    it("parses repo name with dots (HTTPS)", () => {
      const result = parseRepoFromRemote("https://github.com/owner/my.repo.git");
      assert.deepEqual(result, { owner: "owner", repo: "my.repo" });
    });

    it("parses repo name with dots (SSH)", () => {
      const result = parseRepoFromRemote("git@github.com:owner/my.repo.git");
      assert.deepEqual(result, { owner: "owner", repo: "my.repo" });
    });

    it("parses HTTPS URL without .git suffix", () => {
      const result = parseRepoFromRemote("https://github.com/owner/my.repo");
      assert.deepEqual(result, { owner: "owner", repo: "my.repo" });
    });
  });
});
