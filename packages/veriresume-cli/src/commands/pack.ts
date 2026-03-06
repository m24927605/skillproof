import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { getManifestPath } from "../core/manifest.ts";
import { hashContent } from "../core/hashing.ts";

export async function runPack(cwd: string): Promise<void> {
  const manifestPath = getManifestPath(cwd);
  const resumePath = path.join(cwd, "resume.md");
  const bundlePath = path.join(cwd, "bundle.zip");

  await access(manifestPath);
  await access(resumePath);

  const manifestContent = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestContent);

  const verification = {
    instructions: "To verify this resume bundle, use: veriresume verify bundle.zip",
    manifest_hash: hashContent(manifestContent),
    signature_count: manifest.signatures?.length || 0,
    generated_at: manifest.generated_at,
  };

  return new Promise((resolve, reject) => {
    const output = createWriteStream(bundlePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`Bundle created: ${bundlePath} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on("error", reject);
    archive.pipe(output);

    archive.file(resumePath, { name: "resume.md" });
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
