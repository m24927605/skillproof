import { marked } from "marked";
import { launch } from "puppeteer-core";
import { findChromePath } from "./browser.ts";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type ExportFormat = "md" | "pdf" | "png" | "jpeg";

export function normalizeFormat(format: string): ExportFormat {
  const lower = format.toLowerCase();
  if (lower === "jpg") return "jpeg";
  if (["md", "pdf", "png", "jpeg"].includes(lower)) return lower as ExportFormat;
  throw new Error(`Unsupported format: ${format}. Use md, pdf, png, jpeg, or jpg.`);
}

export function markdownToHtml(markdown: string): string {
  const body = marked.parse(markdown) as string;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    max-width: 800px;
    margin: 40px auto;
    padding: 0 20px;
    line-height: 1.6;
    color: #333;
  }
  h1 { border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { color: #555; margin-top: 32px; }
  h3 { color: #666; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f4f4f4; padding: 16px; border-radius: 6px; overflow-x: auto; }
  blockquote { border-left: 4px solid #ddd; margin-left: 0; padding-left: 16px; color: #666; }
  details { margin: 16px 0; }
  summary { cursor: pointer; font-weight: bold; }
  hr { border: none; border-top: 1px solid #ddd; margin: 32px 0; }
  ul, ol { padding-left: 24px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export async function exportToFormat(
  markdown: string,
  format: ExportFormat,
  outputPath: string,
): Promise<void> {
  if (format === "md") {
    await writeFile(outputPath, markdown, "utf8");
    return;
  }

  const html = markdownToHtml(markdown);
  const chromePath = await findChromePath();

  const tmpHtml = path.join(os.tmpdir(), `veriresume-${Date.now()}.html`);
  await writeFile(tmpHtml, html, "utf8");

  const browser = await launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`file://${tmpHtml}`, { waitUntil: "networkidle0" });

    if (format === "pdf") {
      await page.pdf({
        path: outputPath,
        format: "A4",
        printBackground: true,
        margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      });
    } else {
      await page.screenshot({
        path: outputPath,
        type: format,
        fullPage: true,
        ...(format === "jpeg" ? { quality: 90 } : {}),
      });
    }
  } finally {
    await browser.close();
    await rm(tmpHtml, { force: true });
  }
}
