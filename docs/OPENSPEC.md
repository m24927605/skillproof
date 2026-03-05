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
.veriresume/resume-manifest.json
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
resume.md
resume-manifest.json
signatures/
verification.json
```

---

# 3. High Level Architecture

The system has three layers.

```
Claude Code Plugin
        ↓
Veriresume CLI
        ↓
Evidence + Manifest System
```

---

# 4. Repository Structure

The project must generate the following structure.

```
veriresume-claude-plugin/

.claude-plugin/
  plugin.json

commands/
  resume-scan.md
  resume-infer.md
  resume-render.md
  resume-sign.md
  resume-pack.md
  resume-verify.md
  resume-all.md

skills/
  resume/
    SKILL.md
    templates/
      resume.modern.md

packages/
  veriresume-cli/
    package.json
    tsconfig.json
    src/
      index.ts
      commands/
        scan.ts
        infer.ts
        render.ts
        sign.ts
        pack.ts
        verify.ts
      core/
        manifest.ts
        evidence.ts
        skills.ts
        git.ts
        hashing.ts
        security.ts
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
  "name": "veriresume",
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

# 6. Claude Slash Commands

Commands are located in:

```
commands/
```

---

## /resume-scan

Purpose:

Scan the repository and generate evidence.

Command file:

```
commands/resume-scan.md
```

Content:

```
description disable-model-invocation

Scan repository and generate evidence graph.

true

Invoke the veriresume:resume skill and follow the "resume-scan" procedure exactly as presented to you
```

---

## /resume-infer

Infer skills from evidence.

```
commands/resume-infer.md
```

---

## /resume-render

Generate resume markdown.

```
commands/resume-render.md
```

---

## /resume-sign

Sign resume manifest.

```
commands/resume-sign.md
```

---

## /resume-pack

Create distributable resume bundle.

```
commands/resume-pack.md
```

---

## /resume-verify

Verify resume bundle authenticity.

```
commands/resume-verify.md
```

---

## /resume-all

Run the entire pipeline.

```
commands/resume-all.md
```

---

# 7. Skill Definition

Skill logic is defined in:

```
skills/resume/SKILL.md
```

The skill defines procedures used by slash commands.

---

# 8. CLI Tool

A local CLI tool called:

```
veriresume
```

Must be implemented in TypeScript.

---

## CLI Commands

```
veriresume scan
veriresume infer-skills
veriresume render
veriresume sign
veriresume pack
veriresume verify
```

---

# 9. Manifest Schema

File:

```
.veriresume/resume-manifest.json
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

# 10. Evidence Model

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

# 11. Skill Inference

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

# 12. Resume Generation

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

# 13. Resume Bundle

Output:

```
bundle.zip
```

Contains:

```
resume.md
resume-manifest.json
signatures/
verification.json
```

---

# 14. Multi-Signature System

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

# 15. Security Requirements

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

# 16. Implementation Requirements

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

# 17. Acceptance Criteria

Running the command:

```
/resume-all
```

Must produce:

```
resume.md
bundle.zip
verification report
```

Each skill must reference evidence entries.

---

# 18. Future Extensions

Possible future features:

* GitHub PR integration
* open-source contribution graphs
* skill depth analysis
* enterprise verification

---

# End of Spec

---
