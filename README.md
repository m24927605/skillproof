# VeriResume

VeriResume is a Claude Code plugin that generates **verifiable developer resumes** by scanning your source code repositories. Every skill claim is backed by concrete evidence — commits, dependencies, config files — with confidence scores and cryptographic signatures.

## How it works

Navigate to any git repository and run `/resume-all`. VeriResume scans your commits, dependencies, and config files to build an evidence graph. It then infers your skills using 20+ static signal rules plus Claude's reasoning for deeper analysis (architecture patterns, testing practices, code quality).

The result is a `resume.md` where every skill links back to verifiable evidence, plus a signed `bundle.zip` that anyone can independently verify hasn't been tampered with.

## Installation

**Note:** Installation differs by platform. Claude Code has a built-in plugin system. You can also use the CLI standalone.

### Claude Code (via Plugin Marketplace)

In Claude Code, register the marketplace first:

```bash
/plugin marketplace add m24927605/veriresume-marketplace
```

Then install the plugin:

```bash
/plugin install veriresume@veriresume-marketplace
```

### Claude Code (manual)

Clone the repo and install as a local plugin:

```bash
git clone https://github.com/m24927605/veriresume.git
cd veriresume/packages/veriresume-cli
npm install && npm run build
```

Then in Claude Code, add the plugin from the cloned directory:

```bash
/plugin add /path/to/veriresume
```

### Standalone CLI

```bash
git clone https://github.com/m24927605/veriresume.git
cd veriresume/packages/veriresume-cli
npm install && npm run build

# Run in any git repository
npx veriresume scan
npx veriresume infer-skills
npx veriresume render
npx veriresume sign
npx veriresume pack
npx veriresume verify bundle.zip
```

### Verify Installation

Start a new Claude Code session in a git repository and run `/resume-scan`. You should see evidence being extracted from your repo.

## Prerequisites

| Requirement | Version | Required | Notes |
|------------|---------|----------|-------|
| Node.js | >= 22 | Yes | For ESM and TypeScript support |
| git | any | Yes | Must be installed and in PATH |
| git user.name | configured | Yes | `git config --global user.name` |
| git user.email | configured | Yes | `git config --global user.email` |
| gh CLI | any | Optional | Enables GitHub PR evidence |
| unzip | any | Optional | Required for `verify` command |

Run `veriresume doctor` to check your environment:

```bash
npx veriresume doctor
```

## The Pipeline

Run `/resume-all` to execute the full pipeline, or run each step individually:

1. **`/resume-scan`** — Scans your git history, files, dependencies, and config. Builds an evidence graph and writes the manifest to `.veriresume/resume-manifest.json`.

2. **`/resume-infer`** — Infers skills from evidence. First pass uses static signal rules (Dockerfile = Docker, redis dep = Redis, etc.). Second pass uses Claude's reasoning for deeper skills (architecture, testing practices, CI/CD maturity).

3. **`/resume-render`** — Generates `resume.md` from the manifest. Skills sorted by confidence, each linked to evidence entries.

4. **`/resume-sign`** — Signs the manifest with a locally generated Ed25519 key pair. Keys stored in `.veriresume/keys/`.

5. **`/resume-pack`** — Creates `bundle.zip` containing resume, manifest, signatures, and verification metadata.

6. **`/resume-verify`** — Verifies a bundle's cryptographic signatures. Reports pass/fail for each signer.

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

**LLM reasoning (via Claude):**
- Architecture patterns (microservices, monolith, event-driven)
- Testing practices (TDD, integration, e2e)
- Code quality signals (linting, formatting, CI/CD maturity)

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
- Minimal LLM exposure: only paths, names, and structure — never full file contents
- Local-first: no network calls from the CLI
- Private keys stored with `0o600` permissions

### Cryptographic Signing

- **Algorithm:** Ed25519 via Node.js crypto
- **Signed payload:** SHA-256 hash of canonical JSON manifest (sorted keys, no whitespace)
- **Key storage:** `.veriresume/keys/candidate.key` + `.veriresume/keys/candidate.pub`
- **Future:** CI signing (cosign) and third-party policy attestations

## Architecture

```
Claude Code Plugin (slash commands + SKILL.md)
        |
        | orchestrates via bash
        v
TypeScript CLI (veriresume-cli)
        |
        | reads/writes
        v
.veriresume/resume-manifest.json
```

- **Plugin layer** — Slash commands invoke the skill, which orchestrates the CLI and adds LLM reasoning
- **CLI** — Handles deterministic operations: git parsing, hashing, signing, bundling
- **Manifest** — Single source of truth for all evidence, skills, claims, and signatures

## Project Structure

```
veriresume/
├── .claude-plugin/plugin.json        # Plugin metadata
├── commands/                          # Slash commands (7 files)
│   ├── resume-scan.md
│   ├── resume-infer.md
│   ├── resume-render.md
│   ├── resume-sign.md
│   ├── resume-pack.md
│   ├── resume-verify.md
│   └── resume-all.md
├── skills/resume/
│   ├── SKILL.md                      # Skill procedures
│   └── templates/resume.modern.md    # Resume template
├── packages/veriresume-cli/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                  # CLI entry (commander.js)
│       ├── commands/                  # scan, infer, render, sign, pack, verify
│       ├── core/                      # evidence, git, hashing, manifest, security, skills
│       └── types/manifest.ts          # TypeScript interfaces
└── docs/
    └── OPENSPEC.md                   # Full specification
```

## Testing

```bash
cd packages/veriresume-cli
npm test
```

35 tests covering every module plus a full pipeline integration test (scan -> infer -> render -> sign -> pack -> verify).

## Updating

```bash
/plugin update veriresume
```

## Contributing

1. Fork the repository
2. Create a branch for your feature
3. Follow TDD — write failing tests first
4. Submit a PR

## License

MIT License — see LICENSE file for details.

## Support

- **Issues**: https://github.com/m24927605/veriresume/issues
- **Spec**: [docs/OPENSPEC.md](docs/OPENSPEC.md)
