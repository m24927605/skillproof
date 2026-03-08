import type { Manifest } from "../types/manifest.ts";

export function buildVerificationBlock(manifest: Manifest): string {
  let block = `\n---\n\n## SkillProof Verification\n\n`;
  block += `This resume is backed by cryptographic evidence from source code analysis.\n\n`;
  block += `- **Evidence items:** ${manifest.evidence.length}\n`;
  block += `- **Skills verified:** ${manifest.skills.length}\n`;

  if (manifest.repos && manifest.repos.length > 1) {
    block += `- **Repositories:** ${manifest.repos.length}\n`;
    for (const r of manifest.repos) {
      const commitShort = r.head_commit.slice(0, 7);
      block += `  - ${r.name} (${r.url || "local"}, ${commitShort})\n`;
    }
  } else {
    const repoUrl = manifest.repo.url || "local";
    const commitShort = manifest.repo.head_commit.slice(0, 7);
    block += `- **Repository:** ${repoUrl}\n`;
    block += `- **Commit:** ${commitShort}\n`;
  }

  block += `- **Generated:** ${manifest.generated_at}\n`;

  const emails = manifest.author.emails;
  if (emails && emails.length > 1) {
    block += `- **Git Email(s):** ${emails.join(", ")}\n`;
  } else {
    block += `- **Git Email:** ${manifest.author.email}\n`;
  }

  if (manifest.signatures.length === 0) {
    block += `\n> ⚠️ Unsigned — run \`skillproof sign\` first to add cryptographic proof.\n`;
    return block;
  }

  const sig = manifest.signatures[0];
  const fingerprint = sig.public_key.slice(0, 16);

  block += `\n<details>\n<summary>Technical Verification Details</summary>\n\n`;
  // Keep this block stable across the final sign pass in `skillproof all`.
  // Including signature timestamp or manifest hash can make the rendered resume
  // stale immediately after re-signing to lock file_hashes.
  block += `- **Signature algorithm:** ${sig.algorithm}\n`;
  block += `- **Signer:** ${sig.signer}\n`;
  block += `- **Public key fingerprint:** ${fingerprint}\n`;
  block += `- **Verification status:** SIGNED\n\n`;
  block += `To verify: \`skillproof verify bundle.zip\`\n\n`;
  block += `</details>\n`;

  return block;
}
