# SkillProof Design Document

## Overview

Claude Code plugin that scans git repositories, extracts verifiable evidence of developer contributions, infers skills with confidence scores, and generates a cryptographically signed resume bundle.

## Decisions

- **Target repo:** Current working directory only
- **Identity:** Auto-detect from git config (user.name, user.email)
- **Signing:** Local Ed25519 only for v1 (CI/policy deferred)
- **LLM usage:** Claude Code context for reasoning; no separate API calls
- **Tooling:** npm + tsc
- **Architecture:** Thin CLI (deterministic ops) + Heavy Skill (reasoning/inference)

## Architecture

```
Claude Code Plugin (slash commands + SKILL.md)
        |
        | invokes via bash
        v
TypeScript CLI (skillproof)
        |
        | reads/writes
        v
.skillproof/skillproof-manifest.json
```

## Project Structure

```
skillproof/
├── .claude-plugin/plugin.json
├── commands/
│   ├── resume-scan.md
│   ├── resume-infer.md
│   ├── resume-render.md
│   ├── resume-sign.md
│   ├── resume-pack.md
│   ├── resume-verify.md
│   └── resume-all.md
├── skills/resume/
│   ├── SKILL.md
│   └── templates/resume.modern.md
├── packages/skillproof/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── commands/ (scan, infer, render, sign, pack, verify)
│       ├── core/ (manifest, evidence, skills, git, hashing, security)
│       └── types/manifest.ts
└── docs/
```

## Evidence Model

Types: commit, file, snippet, dependency, config.

```typescript
interface Evidence {
  id: string;           // e.g. "EV-COMMIT-abc1234"
  type: "commit" | "file" | "snippet" | "dependency" | "config";
  hash: string;         // SHA-256
  timestamp: string;    // ISO 8601
  ownership: number;    // 0.0-1.0
  source: string;
  metadata?: Record<string, unknown>;
}
```

## Manifest Schema

```typescript
interface Manifest {
  schema_version: "1.0";
  generated_at: string;
  repo: { url: string | null; head_commit: string };
  author: { name: string; email: string };
  evidence: Evidence[];
  skills: Skill[];
  claims: Claim[];
  signatures: Signature[];
}

interface Skill {
  name: string;
  confidence: number;
  evidence_ids: string[];
  inferred_by: "static" | "llm";
}

interface Claim {
  id: string;
  category: "language" | "framework" | "infrastructure" | "tool" | "practice";
  skill: string;
  confidence: number;
  evidence_ids: string[];
}

interface Signature {
  signer: "candidate" | "ci" | "policy";
  public_key: string;
  signature: string;
  timestamp: string;
  algorithm: "Ed25519";
}
```

## Pipeline

```
scan -> infer -> render -> sign -> pack -> verify
```

1. **scan**: Git log parsing, file hashing, dependency extraction, config detection, secret filtering. Writes initial manifest.
2. **infer**: Phase 1 (CLI static signals), Phase 2 (Claude LLM reasoning). Merges skills into manifest.
3. **render**: Apply template, generate resume.md from manifest.
4. **sign**: Ed25519 keypair generation + manifest signing.
5. **pack**: Create bundle.zip (resume.md, manifest, signatures/, verification.json).
6. **verify**: Extract bundle, verify signatures, report results.

## Security

- Blocklist: .env, *.pem, *.key, id_rsa, *credentials*, *secret*
- Content scanning for API keys, private key headers, passwords
- Minimal LLM exposure: paths/names/structure only, not full file contents
- Local-first: no network calls from CLI

## Signing

- Keys: `.skillproof/keys/candidate.key` + `.skillproof/keys/candidate.pub`
- Algorithm: Ed25519 via Node.js crypto
- Signed payload: SHA-256 of canonical JSON manifest (sorted keys, no whitespace)
