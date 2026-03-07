# Self-Contained SKILL.md Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite SKILL.md so Claude Code executes all logic directly without depending on veriresume CLI.

**Architecture:** SKILL.md becomes a pure instruction document. Claude Code uses Bash (git, node -e, zip), Read, and Write tools. No external CLI needed. Only prerequisites: Node.js and git.

**Tech Stack:** git CLI, node -e (crypto), zip/unzip, Claude Code tools (Read/Write/Bash)

---

### Task 1: Rewrite SKILL.md

**Files:**
- Modify: `skills/resume/SKILL.md`

**The new SKILL.md replaces all CLI commands with direct Claude Code instructions.**

Key changes:
- `resume-scan`: Claude runs git commands, reads files, builds manifest JSON, writes it
- `resume-infer`: Claude reads manifest, applies skill detection rules, code reviews, writes back
- `resume-render`: Claude reads manifest, generates resume markdown (already works this way)
- `resume-sign`: Claude runs `node -e` with crypto.generateKeyPairSync/crypto.sign for Ed25519
- `resume-pack`: Claude runs `zip` to bundle files
- `resume-verify`: Claude runs `node -e` with crypto.verify, compares hashes
- `resume-all`: Orchestrates all steps in sequence
