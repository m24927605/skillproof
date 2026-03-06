import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkNodeVersion, checkGit, checkGitConfig, checkCommand, formatResult } from "./doctor.ts";

describe("doctor", () => {
  describe("checkNodeVersion", () => {
    it("returns pass for Node >= 22", () => {
      const result = checkNodeVersion("v22.5.0");
      assert.equal(result.status, "pass");
      assert.equal(result.label, "Node.js");
      assert.equal(result.detail, "v22.5.0 (>= 22 required)");
    });

    it("returns fail for Node < 22", () => {
      const result = checkNodeVersion("v20.11.0");
      assert.equal(result.status, "fail");
      assert.ok(result.fix);
    });
  });

  describe("checkGit", () => {
    it("returns pass when git is available", async () => {
      const result = await checkGit();
      assert.equal(result.status, "pass");
      assert.equal(result.label, "git");
    });
  });

  describe("checkGitConfig", () => {
    it("returns pass for non-empty value", () => {
      const result = checkGitConfig("user.name", "John Doe");
      assert.equal(result.status, "pass");
      assert.equal(result.detail, "John Doe");
    });

    it("returns fail for empty value", () => {
      const result = checkGitConfig("user.name", "");
      assert.equal(result.status, "fail");
      assert.equal(result.label, "git user.name");
      assert.ok(result.fix);
    });
  });

  describe("checkCommand", () => {
    it("returns warn for missing optional command", async () => {
      const result = await checkCommand("nonexistent-cmd-xyz", ["--version"], "test tool", false, "brew install test");
      assert.equal(result.status, "warn");
      assert.equal(result.label, "test tool");
      assert.ok(result.fix);
    });

    it("returns fail for missing required command", async () => {
      const result = await checkCommand("nonexistent-cmd-xyz", ["--version"], "test tool", true, "brew install test");
      assert.equal(result.status, "fail");
    });
  });

  describe("formatResult", () => {
    it("formats pass with checkmark", () => {
      const line = formatResult({ label: "Node.js", status: "pass", detail: "v22.5.0" });
      assert.ok(line.includes("\u2713"));
      assert.ok(line.includes("Node.js"));
      assert.ok(line.includes("v22.5.0"));
    });

    it("formats fail with X and fix hint", () => {
      const line = formatResult({ label: "git", status: "fail", detail: "not found", fix: "brew install git" });
      assert.ok(line.includes("\u2717"));
      assert.ok(line.includes("brew install git"));
    });

    it("formats warn with triangle", () => {
      const line = formatResult({ label: "gh CLI", status: "warn", detail: "not found (optional)", fix: "brew install gh" });
      assert.ok(line.includes("\u25B3"));
      assert.ok(line.includes("brew install gh"));
    });
  });
});
