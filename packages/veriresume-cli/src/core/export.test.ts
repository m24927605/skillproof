import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml, normalizeFormat } from "./export.ts";

describe("export", () => {
  describe("normalizeFormat", () => {
    it("accepts valid formats", () => {
      assert.equal(normalizeFormat("md"), "md");
      assert.equal(normalizeFormat("pdf"), "pdf");
      assert.equal(normalizeFormat("png"), "png");
      assert.equal(normalizeFormat("jpeg"), "jpeg");
    });

    it("normalizes jpg to jpeg", () => {
      assert.equal(normalizeFormat("jpg"), "jpeg");
    });

    it("is case insensitive", () => {
      assert.equal(normalizeFormat("PDF"), "pdf");
      assert.equal(normalizeFormat("Png"), "png");
    });

    it("throws for invalid format", () => {
      assert.throws(() => normalizeFormat("docx"), /Unsupported format/);
    });
  });

  describe("markdownToHtml", () => {
    it("converts markdown to styled HTML document", () => {
      const md = "# Hello\n\nWorld";
      const html = markdownToHtml(md);
      assert.ok(html.includes("<html"));
      assert.ok(html.includes("<h1"));
      assert.ok(html.includes("World"));
      assert.ok(html.includes("<style>"));
    });
  });
});
