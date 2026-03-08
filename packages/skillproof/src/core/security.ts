import path from "node:path";

const SENSITIVE_PATTERNS = [
  /\.env($|\.)/,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
  /credential/i,
  /secret/i,
  /\.p12$/,
  /\.pfx$/,
];

export function isSensitivePath(filePath: string): boolean {
  const basename = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, "/");
  return SENSITIVE_PATTERNS.some(
    (p) => p.test(basename) || p.test(normalized)
  );
}

const SECRET_CONTENT_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN\s+\w*\s*PRIVATE KEY-----/,
  /ghp_[a-zA-Z0-9]{36}/,
  /sk-[a-zA-Z0-9]{32,}/,
];

export function containsSecrets(content: string): boolean {
  return SECRET_CONTENT_PATTERNS.some((p) => p.test(content));
}
