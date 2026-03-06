import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getChromePathCandidates } from "./browser.ts";

describe("browser", () => {
  describe("getChromePathCandidates", () => {
    it("returns platform-specific Chrome paths", () => {
      const candidates = getChromePathCandidates();
      assert.ok(Array.isArray(candidates));
      assert.ok(candidates.length > 0);
      for (const c of candidates) {
        assert.equal(typeof c, "string");
      }
    });

    it("includes CHROME_PATH env var when set", () => {
      const original = process.env.CHROME_PATH;
      process.env.CHROME_PATH = "/custom/chrome";
      try {
        const candidates = getChromePathCandidates();
        assert.equal(candidates[0], "/custom/chrome");
      } finally {
        if (original !== undefined) {
          process.env.CHROME_PATH = original;
        } else {
          delete process.env.CHROME_PATH;
        }
      }
    });
  });
});
