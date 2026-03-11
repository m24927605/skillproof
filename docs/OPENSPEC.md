# docs/OPENSPEC.md

# Verifiable Resume Claude Code Plugin

## OpenSpec v1.0

Author: Michael Chen
Project: Verifiable Resume
Target Environment: Claude Code CLI

---

# 1. Purpose

This project implements a **Claude Code plugin** that can automatically generate a **verifiable developer resume** by scanning a source code repository.

The system must:

* analyze code repositories
* extract verifiable contribution evidence
* infer developer skills
* generate a structured resume
* produce a cryptographically verifiable manifest
* support multi-signature attestations
* generate a portable resume bundle

The plugin integrates with **Claude Code CLI** and exposes slash commands similar to those used in the **superpowers plugin**.

---

# 2. Key Concepts

## 2.1 Verifiable Resume

A resume where every technical claim can be linked to verifiable evidence extracted from a codebase.

Each claim must reference one or more evidence entries.

Example:

```
Redis (confidence 0.82)
Evidence: EV-COMMIT-abc EV-PR-123
```

---

## 2.2 Evidence Graph

The system builds an **evidence graph** representing the developer's contributions.

Evidence types include:

* commits
* files
* configuration
* dependencies
* infrastructure code
* code snippets

Each evidence node contains:

* hash
* timestamp
* ownership score
* source location

---

## 2.3 Skill Inference

Skills are inferred using:

1. static signals (dependencies, file structure)
2. commit analysis
3. infrastructure configuration
4. LLM reasoning

Each skill must include:

* skill name
* confidence score
* evidence references

---

## 2.4 Manifest

All data is stored in a **manifest file**:

```
.skillproof/resume-manifest.json
```

The manifest acts as the **source of truth**.

---

## 2.5 Resume Bundle

The system generates a portable bundle:

```
bundle.zip
```

Containing:

```
resume.md (and/or resume.pdf, resume.png, resume.jpg)
resume-manifest.json
signatures/
verification.json (informational only)
```

**Security model:** File integrity verification uses `manifest.file_hashes` (covered by Ed25519 signature), not `verification.json`. The sign step computes hashes for all resume files and includes them in the manifest before signing. The verify step checks bundled files against these signed hashes. If `file_hashes` is missing from the manifest but resume files exist, verification fails.

---

# 3. High Level Architecture

The system has three layers.

```
Claude Code Plugin
        ↓
SkillProof CLI
        ↓
Evidence + Manifest System
```

---

# 4. Repository Structure

The project must generate the following structure.

```
skillproof-claude-plugin/

.claude-plugin/
  plugin.json

skills/
  all/
    SKILL.md
    templates/
      resume.modern.md

packages/
  skillproof/
    package.json
    tsconfig.json
    src/
      index.ts
      commands/
        scan.ts
        scan-multi.ts
        infer.ts
        render.ts
        sign.ts
        pack.ts
        verify.ts
        doctor.ts
        all.ts
      core/
        manifest.ts
        evidence.ts
        evidence-digest.ts
        skills.ts
        skill-grouping.ts
        static-quality.ts
        git.ts
        github.ts
        hashing.ts
        security.ts
        identity.ts
        llm.ts
        code-review.ts
        review-cache.ts
        review-gate.ts
        token-estimate.ts
        verification.ts
        browser.ts
        export.ts
        config.ts
        merge.ts
        prompt.ts
      types/
        manifest.ts

docs/
  OPENSPEC.md
```

---

# 5. Claude Plugin Definition

File:

```
.claude-plugin/plugin.json
```

Example:

```json
{
  "name": "skillproof",
  "description": "Generate verifiable developer resumes from source code",
  "version": "0.1.0",
  "author": {
    "name": "Michael Chen"
  },
  "license": "MIT",
  "keywords": [
    "resume",
    "skills",
    "provenance",
    "attestation"
  ]
}
```

---

# 6. Skill Definition

Skill logic is defined in:

```
skills/all/SKILL.md
```

The skill defines procedures for the full pipeline and individual steps.

---

# 7. CLI Tool

A local CLI tool called:

```
skillproof
```

Must be implemented in TypeScript.

---

## CLI Commands

```
skillproof scan
skillproof infer-skills
skillproof render
skillproof sign
skillproof pack
skillproof verify
```

---

# 8. Manifest Schema

File:

```
.skillproof/resume-manifest.json
```

Example:

```json
{
  "schema_version": "1.0",
  "repo": {
    "url": "https://github.com/example/repo",
    "head_commit": "abc123"
  },
  "evidence": [],
  "skills": [],
  "claims": []
}
```

---

# 9. Evidence Model

Evidence types:

```
commit
file
snippet
dependency
config
```

Example:

```
EV-COMMIT-abc
EV-FILE-dockerfile
EV-DEP-redis
```

Evidence fields:

```
id
type
hash
ownership
timestamp
```

---

# 10. Skill Inference

Skills are inferred from repository signals.

## Static Signals

| Signal           | Skill      |
| ---------------- | ---------- |
| Dockerfile       | Docker     |
| helm chart       | Kubernetes |
| terraform        | Terraform  |
| aws-sdk          | AWS        |
| redis dependency | Redis      |

---

## LLM Signals

Claude analyzes:

* infrastructure configuration
* backend architecture
* queue systems
* database layers

Output format:

```
skill
confidence
evidence_ids
```

---

# 11. Resume Generation

Output file:

```
resume.md
```

Example:

```
Skills

Redis
confidence: 0.82
evidence: EV-PR-12 EV-COMMIT-abc

AWS Lambda
confidence: 0.77
evidence: EV-FILE-serverless
```

---

# 12. Resume Bundle

Output:

```
bundle.zip
```

Contains:

```
resume.md (and/or resume.pdf, resume.png, resume.jpg)
resume-manifest.json
signatures/
verification.json (informational — not used for integrity verification)
```

**Integrity model:** The manifest includes a `file_hashes` field containing SHA-256 hashes of all resume files. This field is computed during the sign step and covered by the Ed25519 signature. The verify step validates bundled files against `manifest.file_hashes`, not `verification.json`. This prevents attacks where both resume files and `verification.json` are simultaneously tampered.

---

# 13. Multi-Signature System

Supported signatures:

### Candidate

Developer signs manifest using local key.

### CI

GitHub Actions signs manifest using:

```
cosign sign-blob
```

### Policy

Optional third-party attestation.

---

# 14. Security Requirements

The system must enforce:

* local-first repository scanning
* secret detection
* minimal LLM exposure
* hash-based evidence

Sensitive files:

```
.env
*.pem
id_rsa
private keys
```

Must never be exposed.

---

# 15. Implementation Requirements

Claude Code must implement:

1. Git repository scanning
2. Evidence graph generation
3. Skill inference engine
4. Resume markdown generator
5. Manifest schema
6. Signature system
7. Bundle generation
8. Verification tool
9. Claude plugin commands

---

# 16. Acceptance Criteria

Running the command:

```
/skillproof-all
```

Must produce:

```
resume.md
bundle.zip
verification report
```

Each skill must reference evidence entries.

---

# 17. Future Extensions

Possible future features:

* GitHub PR integration
* open-source contribution graphs
* skill depth analysis
* enterprise verification

---

# End of Spec

---
