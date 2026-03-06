import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashContent, hashFile, canonicalJson } from "./hashing.ts";

describe("hashing", () => {
  describe("hashContent", () => {
    it("returns consistent SHA-256 hex for same input", () => {
      const hash1 = hashContent("hello world");
      const hash2 = hashContent("hello world");
      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64);
    });

    it("returns different hashes for different input", () => {
      const hash1 = hashContent("hello");
      const hash2 = hashContent("world");
      assert.notEqual(hash1, hash2);
    });
  });

  describe("canonicalJson", () => {
    it("sorts keys deterministically", () => {
      const obj1 = { b: 2, a: 1 };
      const obj2 = { a: 1, b: 2 };
      assert.equal(canonicalJson(obj1), canonicalJson(obj2));
    });

    it("produces no whitespace", () => {
      const result = canonicalJson({ a: 1, b: [2, 3] });
      assert.ok(!result.includes(" "));
      assert.ok(!result.includes("\n"));
    });
  });
});
