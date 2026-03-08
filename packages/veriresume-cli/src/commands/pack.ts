import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { getManifestPath } from "../core/manifest.ts";
import { hashContent } from "../core/hashing.ts";

const RESUME_FORMATS = ["resume.md", "resume.pdf", "resume.png", "resume.jpg", "resume.jpeg"];

export async function runPack(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const bundlePath = path.join(cwd, "bundle.zip");

  await access(manifestPath);

  const resumeFiles: string[] = [];
  for (const filename of RESUME_FORMATS) {
    try {
      await access(path.join(cwd, filename));
      resumeFiles.push(filename);
    } catch { /* doesn't exist */ }
  }
  if (resumeFiles.length === 0) {
    throw new Error("No resume file found. Run 'veriresume render' first.");
  }

  const manifestContent = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestContent);

  const fileHashes: Record<string, string> = {};
  for (const filename of resumeFiles) {
    const content = await readFile(path.join(cwd, filename));
    fileHashes[filename] = hashContent(content);
  }

  const verification = {
    instructions: "To verify this resume bundle, use: veriresume verify bundle.zip",
    manifest_hash: hashContent(manifestContent),
    resume_hash: fileHashes["resume.md"] || null,
    file_hashes: fileHashes,
    signature_count: manifest.signatures?.length || 0,
    generated_at: manifest.generated_at,
  };

  return new Promise((resolve, reject) => {
    const output = createWriteStream(bundlePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`Bundle created: ${bundlePath} (${archive.pointer()} bytes)`);
      console.log(`Included: ${resumeFiles.join(", ")}`);
      resolve();
    });

    archive.on("error", reject);
    archive.pipe(output);

    for (const filename of resumeFiles) {
      archive.file(path.join(cwd, filename), { name: filename });
    }
    archive.file(manifestPath, { name: "resume-manifest.json" });
    archive.append(JSON.stringify(verification, null, 2), { name: "verification.json" });

    for (const sig of manifest.signatures || []) {
      archive.append(JSON.stringify(sig, null, 2), {
        name: `signatures/${sig.signer}-${sig.timestamp.replace(/[:.]/g, "-")}.json`,
      });
    }

    archive.finalize();
  });
}
