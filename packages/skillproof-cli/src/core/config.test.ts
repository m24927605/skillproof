import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveApiKey, readConfig, writeConfig } from "./config.ts";

describe("config", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `skillproof-test-${Date.now()}`);
    await mkdir(path.join(tmpDir, ".skillproof"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("readConfig", () => {
    it("returns empty object when config does not exist", async () => {
      const config = await readConfig(tmpDir);
      assert.deepEqual(config, {});
    });

    it("reads existing config", async () => {
      const configPath = path.join(tmpDir, ".skillproof", "config.json");
      await writeFile(configPath, JSON.stringify({ anthropic_api_key: "sk-test" }));
      const config = await readConfig(tmpDir);
      assert.equal(config.anthropic_api_key, "sk-test");
    });
  });

  describe("writeConfig", () => {
    it("writes config to file", async () => {
      await writeConfig(tmpDir, { anthropic_api_key: "sk-new" });
      const configPath = path.join(tmpDir, ".skillproof", "config.json");
      const content = JSON.parse(await readFile(configPath, "utf8"));
      assert.equal(content.anthropic_api_key, "sk-new");
    });
  });

  describe("resolveApiKey", () => {
    it("returns env var when set", async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = "sk-env";
      try {
        const key = await resolveApiKey(tmpDir);
        assert.equal(key, "sk-env");
      } finally {
        if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it("falls back to config file", async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        await writeConfig(tmpDir, { anthropic_api_key: "sk-config" });
        const key = await resolveApiKey(tmpDir);
        assert.equal(key, "sk-config");
      } finally {
        if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it("returns null when neither env nor config has key", async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const key = await resolveApiKey(tmpDir);
        assert.equal(key, null);
      } finally {
        if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
      }
    });
  });
});
