# SkillProof

SkillProof is a Claude Code plugin that generates **verifiable developer resumes** by scanning your source code repositories. Every skill claim is backed by concrete evidence — commits, dependencies, config files — with confidence scores and cryptographic signatures.

## How it works

Navigate to any git repository and run `/skillproof-all`. SkillProof scans your commits, dependencies, and config files to build an evidence graph. It then infers your skills using 20+ static signal rules plus Claude's reasoning for deeper analysis (architecture patterns, testing practices, code quality).

The result is a `resume.md` where every skill links back to verifiable evidence, plus a signed `bundle.zip` that anyone can independently verify hasn't been tampered with.

## Installation

**Note:** Installation differs by platform. Claude Code has a built-in plugin system. You can also use the CLI standalone.

### Claude Code (via Plugin Marketplace)

In Claude Code, register the marketplace and install in two steps:

```bash
/plugin marketplace add m24927605/skillproof-marketplace
/plugin install skillproof@skillproof-marketplace
```

Or from the terminal (outside Claude Code):

```bash
claude plugin marketplace add https://github.com/m24927605/skillproof-marketplace.git
claude plugin install skillproof@skillproof-marketplace --scope user
```

Then restart your Claude Code session. Type `/skillproof` to see all available commands.

### Claude Code (manual / local development)

Clone both repos and register the marketplace locally:

```bash
git clone https://github.com/m24927605/skillproof.git
cd skillproof/packages/skillproof
npm install && npm run build
```

Then in Claude Code:

```bash
/plugin marketplace add /path/to/skillproof-marketplace
/plugin install skillproof@skillproof-marketplace
```

### Standalone CLI (npm)

```bash
npm install -g @m24927605/skillproof

# Run full pipeline in any git repository
skillproof all

# Or run each step individually
skillproof scan
skillproof infer-skills
skillproof render
skillproof sign
skillproof pack
skillproof verify bundle.zip
```

### Standalone CLI (from source)

```bash
git clone https://github.com/m24927605/skillproof.git
cd skillproof/packages/skillproof
npm install && npm run build
npx skillproof doctor
```

### Verify Installation

Start a new Claude Code session in a git repository and run `/skillproof-scan`. You should see evidence being extracted from your repo.

## Prerequisites

| Requirement | Version | Required | Notes |
|------------|---------|----------|-------|
| Node.js | >= 22 | Yes | For ESM and TypeScript support |
| git | any | Yes | Must be installed and in PATH |
| git user.name | configured | Yes | `git config --global user.name` |
| git user.email | configured | Yes | `git config --global user.email` |
| gh CLI | any | Optional | Enables GitHub PR evidence |
| unzip | any | Yes | Required for `verify` command |
| zipinfo | any | Yes | Required for `verify` command (Zip Slip protection) |

Run `skillproof doctor` to check your environment:

```bash
npx skillproof doctor
```

## The Pipeline

Run `skillproof all` (CLI) or `/skillproof-all` (Claude Code plugin) to execute the full pipeline, or run each step individually:

1. **`/skillproof-scan`** — Scans your git history, files, dependencies, and config. Builds an evidence graph and writes the manifest to `.skillproof/resume-manifest.json`.

2. **`/skillproof-infer`** — Infers skills from evidence using hybrid analysis. All skills receive a deterministic `static_confidence` score. A review gating policy selects high-value or uncertain skills for Claude code review; the rest are scored statically. Reviewed skills get a blended confidence (35% static + 65% LLM). `--dry-run` shows the review/skip split and cost estimate without making API calls.

3. **`/skillproof-render`** — Generates `resume.md` from the manifest. Skills sorted by confidence, each linked to evidence entries.

4. **`/skillproof-sign`** — Signs the manifest with a locally generated Ed25519 key pair. Automatically computes `file_hashes` for all resume files (md, pdf, png, jpg) and includes them in the signed manifest for tamper detection. **Must run after render** so file hashes cover all output formats.

5. **`/skillproof-pack`** — Creates `bundle.zip` containing resume, manifest, signatures, and verification metadata.

6. **`/skillproof-verify`** — Verifies a bundle's cryptographic signatures and file integrity. Uses signed `manifest.file_hashes` (not unsigned `verification.json`) for tamper detection. Reports INVALID if `file_hashes` is missing but resume files exist.

## What's Inside

### Skill Inference Engine

**Static signals (20+ rules):**

| Signal | Inferred Skill |
|--------|---------------|
| `Dockerfile` | Docker |
| `*.tf` files | Terraform |
| `.github/workflows/` | GitHub Actions |
| `redis` dependency | Redis |
| `*.ts` / `*.tsx` files | TypeScript |
| `react` dependency | React |
| `express` dependency | Express |
| `aws-sdk` dependency | AWS |
| ...and more | |

**Deterministic quality analysis (all skills):**
- File ownership, test presence, CI/CD, linting, type checking
- Conservative scoring for dependency/config-only skills
- Accepts all evidence types: file, dependency, config, commit, snippet, PR

**Review gating (selective LLM):**
- High-value skills (languages, frameworks, infrastructure) reviewed at mid-range confidence
- Strong/overdetermined skills and weak-evidence skills skip LLM
- Budget-controlled via `--max-review-tokens`

**LLM reasoning (via Claude, selected skills only):**
- Compact evidence digests replace raw file dumps (lower token cost)
- Architecture patterns, testing practices, code quality
- Results cached per-skill for fast reruns

### Evidence Model

Five types of evidence, each with a hash, timestamp, and ownership score:

| Type | Example ID | Source |
|------|-----------|--------|
| `commit` | `EV-COMMIT-abc1234` | Git log |
| `file` | `EV-FILE-9f86d08...` | File content hash |
| `dependency` | `EV-DEP-redis` | package.json, requirements.txt, go.mod, Cargo.toml |
| `config` | `EV-CONFIG-3c7a2b...` | Dockerfile, Terraform, Helm, CI workflows |
| `snippet` | `EV-SNIPPET-e5fa44...` | Code excerpts |

### Security

- Sensitive files blocklisted: `.env`, `*.pem`, `*.key`, `id_rsa`, `*credentials*`, `*secret*`
- Content scanning for AWS keys (`AKIA...`), private key headers, GitHub tokens
- LLM code review sends truncated file content (up to 150 lines per file) to the Anthropic API for skill assessment
- Network calls: Anthropic API for code review (infer) and resume generation (render with locale)
- Private keys stored with `0o600` permissions

### Cryptographic Signing

- **Algorithm:** Ed25519 via Node.js crypto
- **Signed payload:** SHA-256 hash of canonical JSON manifest (sorted keys, no whitespace)
- **Key storage:** `.skillproof/keys/candidate.key` + `.skillproof/keys/candidate.pub`
- **Future:** CI signing (cosign) and third-party policy attestations

## Architecture

```
Claude Code Plugin (slash commands + SKILL.md)
        |
        | orchestrates via bash
        v
TypeScript CLI (skillproof)
        |
        | reads/writes
        v
.skillproof/resume-manifest.json
```

- **Plugin layer** — Slash commands invoke the skill, which orchestrates the CLI and adds LLM reasoning
- **CLI** — Handles deterministic operations: git parsing, hashing, signing, bundling
- **Manifest** — Single source of truth for all evidence, skills, claims, and signatures

## Project Structure

```
skillproof/
├── .claude-plugin/plugin.json        # Plugin metadata
├── commands/                          # Slash commands (skillproof-*)
│   ├── skillproof-scan.md
│   ├── skillproof-infer.md
│   ├── skillproof-render.md
│   ├── skillproof-sign.md
│   ├── skillproof-pack.md
│   ├── skillproof-verify.md
│   └── skillproof-all.md
├── skills/resume/
│   ├── SKILL.md                      # Skill procedures
│   └── templates/resume.modern.md    # Resume template
├── packages/skillproof/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                  # CLI entry (commander.js)
│       ├── commands/                  # scan, infer, render, sign, pack, verify
│       ├── core/                      # evidence, git, hashing, manifest, security, skills
│       └── types/manifest.ts          # TypeScript interfaces
└── docs/
    ├── OPENSPEC.md                   # Full specification
    └── plans/archive/                # Completed design & implementation plans
```

## Testing

```bash
cd packages/skillproof
npm test
```

190+ tests covering every module plus a full pipeline integration test (scan -> infer -> render -> sign -> pack -> verify).

## Updating

```bash
/plugin update skillproof@skillproof-marketplace
```

## Contributing

1. Fork the repository
2. Create a branch for your feature
3. Follow TDD — write failing tests first
4. Submit a PR

## License

MIT License — see LICENSE file for details.

## Support

- **Issues**: https://github.com/m24927605/skillproof/issues
- **Spec**: [docs/OPENSPEC.md](docs/OPENSPEC.md)
