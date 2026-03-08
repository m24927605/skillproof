import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSensitivePath, containsSecrets } from "./security.ts";

describe("security", () => {
  describe("isSensitivePath", () => {
    it("blocks .env files", () => {
      assert.equal(isSensitivePath(".env"), true);
      assert.equal(isSensitivePath("config/.env.local"), true);
    });

    it("blocks key files", () => {
      assert.equal(isSensitivePath("server.pem"), true);
      assert.equal(isSensitivePath("id_rsa"), true);
      assert.equal(isSensitivePath("secrets/private.key"), true);
    });

    it("blocks credential files", () => {
      assert.equal(isSensitivePath("credentials.json"), true);
      assert.equal(isSensitivePath("aws-credentials"), true);
    });

    it("allows normal files", () => {
      assert.equal(isSensitivePath("src/index.ts"), false);
      assert.equal(isSensitivePath("package.json"), false);
      assert.equal(isSensitivePath("README.md"), false);
    });
  });

  describe("containsSecrets", () => {
    it("detects AWS access keys", () => {
      assert.equal(containsSecrets("key = AKIAIOSFODNN7EXAMPLE"), true);
    });

    it("detects private key headers", () => {
      assert.equal(containsSecrets("-----BEGIN RSA PRIVATE KEY-----"), true);
      assert.equal(containsSecrets("-----BEGIN EC PRIVATE KEY-----"), true);
    });

    it("allows normal code", () => {
      assert.equal(containsSecrets("const x = 42;"), false);
      assert.equal(containsSecrets("import redis from 'redis';"), false);
    });
  });
});
