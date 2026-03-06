import type { Manifest } from "../types/manifest.ts";
import { canonicalJson, hashContent } from "./hashing.ts";

export function buildVerificationBlock(manifest: Manifest): string {
  const commitShort = manifest.repo.head_commit.slice(0, 7);
  const repoUrl = manifest.repo.url || "local";

  let block = `\n---\n\n## VeriResume Verification\n\n`;
  block += `This resume is backed by cryptographic evidence from source code analysis.\n\n`;
  block += `- **Evidence items:** ${manifest.evidence.length}\n`;
  block += `- **Skills verified:** ${manifest.skills.length}\n`;
  block += `- **Repository:** ${repoUrl}\n`;
  block += `- **Commit:** ${commitShort}\n`;
  block += `- **Generated:** ${manifest.generated_at}\n`;

  if (manifest.signatures.length === 0) {
    block += `\n> ⚠️ Unsigned — run \`veriresume sign\` first to add cryptographic proof.\n`;
    return block;
  }

  const sig = manifest.signatures[0];
  const manifestForHash = { ...manifest, signatures: [] };
  const manifestHash = hashContent(canonicalJson(manifestForHash));
  const fingerprint = sig.public_key.slice(0, 16);

  block += `\n<details>\n<summary>Technical Verification Details</summary>\n\n`;
  block += `- **Manifest hash:** ${manifestHash}\n`;
  block += `- **Signature algorithm:** ${sig.algorithm}\n`;
  block += `- **Signer:** ${sig.signer}\n`;
  block += `- **Public key fingerprint:** ${fingerprint}\n`;
  block += `- **Signed at:** ${sig.timestamp}\n`;
  block += `- **Verification status:** SIGNED\n\n`;
  block += `To verify: \`veriresume verify bundle.zip\`\n\n`;
  block += `</details>\n`;

  return block;
}
