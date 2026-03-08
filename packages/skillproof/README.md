# skillproof

Generate **verifiable developer resumes** from source code. Every skill claim is backed by concrete evidence — commits, dependencies, config files — with confidence scores and cryptographic signatures.

## Install

```bash
npm install -g skillproof
```

### Prerequisites

| Requirement | Version | Required | Notes |
|------------|---------|----------|-------|
| Node.js | >= 22 | Yes | ESM and TypeScript support |
| git | any | Yes | Must be in PATH |
| git user.name | configured | Yes | `git config --global user.name` |
| git user.email | configured | Yes | `git config --global user.email` |
| gh CLI | any | Optional | Enables GitHub PR evidence |
| unzip | any | Yes | Required for `verify` command |
| zipinfo | any | Yes | Required for `verify` command (Zip Slip protection) |

Check your environment:

```bash
skillproof doctor
```

## Quick Start

Run the full pipeline in any git repository:

```bash
skillproof all
```

This executes: **scan → infer → render → sign → pack → verify**

Or run each step individually:

```bash
skillproof scan              # Extract evidence from git history, files, deps
skillproof infer-skills      # Infer skills from evidence (static + LLM)
skillproof render             # Generate resume.md
skillproof sign               # Sign manifest with Ed25519
skillproof pack               # Create bundle.zip
skillproof verify bundle.zip  # Verify bundle authenticity
```

## Commands

### `skillproof scan`

Scans your git history, files, dependencies, and config. Builds an evidence graph and writes the manifest to `.skillproof/resume-manifest.json`.

### `skillproof infer-skills`

Infers skills from evidence. Uses 20+ static signal rules plus optional Claude API reasoning for deeper analysis.

### `skillproof render [locale]`

Generates a resume from the manifest.

```bash
skillproof render                           # English markdown
skillproof render zh-TW                     # Chinese (Traditional)
skillproof render --format pdf -o resume.pdf  # PDF output
```

| Option | Description |
|--------|-------------|
| `[locale]` | Target locale (e.g., `zh-TW`, `ja`, `en-US`) |
| `--format <fmt>` | Output format: `md`, `pdf`, `png`, `jpeg` (default: `md`) |
| `-o, --output <path>` | Output file path |
| `--api-key <key>` | Anthropic API key (skips prompt) |
| `--yes` | Skip interactive prompts (CI mode) |

### `skillproof sign`

Signs the manifest with a locally generated Ed25519 key pair. Keys stored in `.skillproof/keys/`.

### `skillproof pack`

Creates `bundle.zip` containing resume, manifest, signatures, and verification metadata.

### `skillproof verify <bundle>`

Verifies a bundle's cryptographic signatures. Reports pass/fail for each signer.

### `skillproof scan-multi`

Scans multiple repositories and merges into one resume.

```bash
skillproof scan-multi                  # Scan local sub-directories
skillproof scan-multi --github         # Scan remote GitHub repos
skillproof scan-multi --path ~/projects
```

### `skillproof all`

Runs the full pipeline with interactive prompts.

```bash
skillproof all
skillproof all --scan-mode local-multi --locale zh-TW --format pdf
```

| Option | Description |
|--------|-------------|
| `--scan-mode <mode>` | `current`, `local-multi`, or `github` |
| `--parent-dir <dir>` | Parent directory for local-multi scan |
| `--repos <names>` | Comma-separated repo names |
| `--emails <addrs>` | Comma-separated email addresses |
| `--locale <locale>` | Resume locale |
| `--format <fmt>` | Output format |
| `-o, --output <path>` | Output file path |

### `skillproof list-repos`

Discovers git repositories under a directory.

```bash
skillproof list-repos --path ~/projects
```

### `skillproof list-emails`

Collects all git committer emails from specified repos.

```bash
skillproof list-emails --path ~/projects --repos repo1,repo2
```

### `skillproof doctor`

Checks all prerequisites and displays a diagnostic table.

## Evidence Model

Five types of evidence, each with a hash, timestamp, and ownership score:

| Type | Example | Source |
|------|---------|--------|
| `commit` | `EV-COMMIT-abc1234` | Git log |
| `file` | `EV-FILE-9f86d08...` | File content hash |
| `dependency` | `EV-DEP-redis` | package.json, go.mod, Cargo.toml |
| `config` | `EV-CONFIG-3c7a2b...` | Dockerfile, Terraform, CI workflows |
| `snippet` | `EV-SNIPPET-e5fa44...` | Code excerpts |

## Skill Inference

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

**LLM reasoning (via Claude API):**
- Architecture patterns (microservices, monolith, event-driven)
- Testing practices (TDD, integration, e2e)
- Code quality signals (linting, formatting, CI/CD maturity)

## Security

- Sensitive files blocklisted: `.env`, `*.pem`, `*.key`, `id_rsa`, `*credentials*`, `*secret*`
- Content scanning for AWS keys, private key headers, GitHub tokens
- Minimal LLM exposure: only paths, names, and structure — never full file contents
- Ed25519 signatures via Node.js crypto
- Private keys stored with `0o600` permissions

## Also Available as Claude Code Plugin

SkillProof can also be used as a Claude Code plugin with slash commands:

```bash
# Register marketplace
/plugin marketplace add m24927605/skillproof-marketplace

# Install
/plugin install skillproof@skillproof-marketplace

# Use
/skillproof-all
```

## License

MIT
