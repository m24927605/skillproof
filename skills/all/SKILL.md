name: all
description: Generate verifiable developer resumes from source code repositories

---

## Prerequisites

- `git` installed
- `node` >= 22 installed (for Ed25519 crypto)
- `gh` installed and authenticated (optional, for GitHub PR evidence)

## Default Behavior

When this skill is invoked without specifying a procedure, run the full pipeline using a two-phase approach: Claude Code handles user interaction via AskUserQuestion, then calls the CLI in non-interactive mode with flags.

---

**⛔ FORBIDDEN BEHAVIORS — VIOLATION OF THESE IS A CRITICAL ERROR:**

1. Do NOT classify, group, or categorize repositories (e.g., "DeFi/Blockchain", "Backend focused"). This is STRICTLY FORBIDDEN.
2. Do NOT create summary options like "Select by category".
3. Do NOT use your own judgment to organize or filter the repo list.
4. Do NOT truncate or omit repos from the list — show ALL of them.

**❌ WRONG — never do this:**
```
1. DeFi/Blockchain focused (compound-protocol, cream-backend, ...)
2. Backend focused (alien-backend, ...)
3. Type something
```

**✅ CORRECT — always do this:**
First, output the full numbered list as plain text so the user can see ALL repos at once:
```
Found 30 repositories:
 1. AIFT_Vulcan_interview
 2. alien-backend
 3. bobaoppa-api
 4. bold
 5. compound-protocol
 ...
30. usdy-stats
```
Then use AskUserQuestion to ask: "Which repos to include? Enter numbers, ranges, or 'all'. Example: 1,3,5-10,15"

The user can type:
- `all` — include every repo
- `1,3,5` — specific repos by number
- `1-10,15,20-25` — ranges and individual numbers mixed
- Repo names directly (e.g. `alien-backend,bold`)

---

**Phase 1: Gather user choices via AskUserQuestion**

1. Ask scan mode (present choices: "Current project only", "Multiple local projects", "GitHub remote repos").

2. If "Multiple local projects":
   a. Ask for the parent directory path (default: current directory).
   b. Discover repos by running:
      ```bash
      node --experimental-strip-types /Users/sin-chengchen/github.com/skillproof/packages/skillproof/src/index.ts list-repos --path "<parent_dir>"
      ```
      This outputs a JSON array of repo names.
   c. Output the COMPLETE numbered list of repos as plain text (sorted alphabetically, one per line). Then use AskUserQuestion to ask which repos to include. The user types numbers, ranges (e.g. `1,3,5-10`), repo names, or `all`.
   d. Collect emails by running the CLI command (do NOT use `git config` — it misses committer emails):
      ```bash
      node --experimental-strip-types /Users/sin-chengchen/github.com/skillproof/packages/skillproof/src/index.ts list-emails --path "<parent_dir>" --repos "<repo1>,<repo2>,..."
      ```
      This outputs a JSON array of all unique emails (author + committer) from git log. Present all emails to the user to confirm which are theirs.

3. If "Current project only": no extra input needed.

4. Ask locale (e.g., en-US, zh-TW), format (md/pdf/png/jpeg), and output path.

**Phase 2: Execute CLI in non-interactive mode**

Run the CLI with all flags so it skips all interactive prompts:

For current project:
```bash
node --experimental-strip-types /Users/sin-chengchen/github.com/skillproof/packages/skillproof/src/index.ts all \
  --scan-mode current \
  --locale "<locale>" --format "<format>" -o "<output>" \
  --max-review-tokens 200000 --yes
```

For multiple local projects:
```bash
node --experimental-strip-types /Users/sin-chengchen/github.com/skillproof/packages/skillproof/src/index.ts all \
  --scan-mode local-multi \
  --parent-dir "<parent_dir>" \
  --repos "<repo1>,<repo2>,<repo3>" \
  --emails "<email1>,<email2>" \
  --locale "<locale>" --format "<format>" -o "<output>" \
  --max-review-tokens 200000 --yes
```

**IMPORTANT:**
- Do NOT run the CLI without flags — it will hang waiting for interactive input.
- Do NOT skip Phase 1 — always ask the user first.

## Data Locations

All data is stored under `.skillproof/` in the target project directory:

- `.skillproof/resume-manifest.json` — the evidence manifest
- `.skillproof/keys/candidate.pub` — Ed25519 public key (PEM)
- `.skillproof/keys/candidate.key` — Ed25519 private key (PEM)
- `resume.md` — the generated resume
- `bundle.zip` — the distributable bundle

## Manifest Schema

```json
{
  "schema_version": "1.0",
  "generated_at": "ISO-8601",
  "repo": { "url": "string|null", "head_commit": "string" },
  "author": { "name": "string", "email": "string", "emails": ["string"] },
  "evidence": [
    { "id": "string", "type": "commit|file|dependency|config|pull_request", "hash": "SHA-256", "timestamp": "ISO-8601", "ownership": 0.0-1.0, "source": "string", "metadata": {} }
  ],
  "skills": [
    {
      "name": "string", "confidence": 0.0-1.0, "evidence_ids": ["string"],
      "inferred_by": "static|llm", "strengths": ["string"], "reasoning": "string",
      "static_confidence": 0.0-1.0, "llm_confidence": 0.0-1.0,
      "review_priority": 0.0-1.0, "review_decision": "static-only|llm-reviewed|cached-llm",
      "evidence_digest": ["string"]
    }
  ],
  "claims": [
    { "id": "string", "category": "language|framework|infrastructure|tool|practice", "skill": "string", "confidence": 0.0-1.0, "evidence_ids": ["string"] }
  ],
  "signatures": [
    { "signer": "candidate|ci|policy", "public_key": "base64", "signature": "base64", "timestamp": "ISO-8601", "algorithm": "Ed25519" }
  ]
}
```

## Procedures

### skillproof-scan

Collect evidence from the current git repository and write the manifest.

1. **Gather git metadata** using Bash:
   ```bash
   git config user.name
   git config user.email
   git rev-parse HEAD
   git remote get-url origin 2>/dev/null || echo ""
   ```

2. **Collect commit evidence** using Bash:
   ```bash
   git log --author="<author_email>" --pretty=format:"%h|%an|%ae|%aI|%s" --no-merges
   ```
   For each commit, create an evidence entry:
   - `id`: `EV-COMMIT-<hash>`
   - `type`: `commit`
   - `hash`: SHA-256 of `"<hash>|<message>"`
   - `timestamp`: commit date
   - `ownership`: 1.0
   - `source`: commit hash

3. **Collect file evidence** using Bash + Read:
   ```bash
   git ls-files
   ```
   - Skip sensitive paths: `.env`, `.pem`, `.key`, `id_rsa`, `id_ed25519`, `credential`, `secret`
   - Skip files > 1MB
   - For each eligible file, compute ownership:
     ```bash
     git blame --porcelain -- <file>
     ```
     Parse `author-mail` lines, count lines by the author's email, divide by total lines.
   - Read file content, skip if it contains secret patterns (AWS keys `AKIA...`, private key headers, GitHub tokens `ghp_...`)
   - Create evidence: `id`: `EV-FILE-<hash_first_12>`, `type`: `file`, `hash`: SHA-256 of content

4. **Collect dependency evidence** by reading dependency files:
   - `package.json` → parse `dependencies` + `devDependencies` keys
   - `requirements.txt` → parse package names (lines not starting with `#`)
   - `go.mod` → parse module paths after `require`
   - `Cargo.toml` → parse keys under `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]` sections only
   - For each: `id`: `EV-DEP-<name>`, `type`: `dependency`

5. **Collect config evidence** for files matching:
   - `Dockerfile*`, `docker-compose*`, `.github/workflows/*`, `*.tf`, `helm/*`, `*.k8s/*`, `serverless.*`
   - Read content, create evidence: `id`: `EV-CONFIG-<hash_first_12>`, `type`: `config`

6. **Collect PR evidence** (if `gh` is authenticated):
   ```bash
   gh auth status 2>&1
   gh api user --jq '.login'
   gh api 'repos/<owner>/<repo>/pulls?state=closed&per_page=100'
   ```
   - Filter to merged PRs (`merged_at != null`) by the author's login
   - For each: `id`: `EV-PR-<number>`, `type`: `pull_request`

7. **Hash all content** using:
   ```bash
   echo -n "<content>" | shasum -a 256 | cut -d' ' -f1
   ```
   Or for large content, use `node -e`:
   ```bash
   node -e "const c=require('crypto');process.stdout.write(c.createHash('sha256').update(require('fs').readFileSync(process.argv[1],'utf8')).digest('hex'))" <file>
   ```

8. **Assemble and write the manifest** using the Write tool to `.skillproof/resume-manifest.json`.

9. **Report** to user: total evidence count, broken down by type.

### skillproof-infer

Detect skills from evidence and score them using hybrid analysis: deterministic static scoring for all skills, with selective Claude code review for high-value or uncertain skills.

1. **Read** `.skillproof/resume-manifest.json`.

2. **Apply skill detection rules** to each evidence item:

   | Skill | Match Rule |
   |-------|-----------|
   | Docker | source matches `dockerfile` or `docker-compose` (case-insensitive) |
   | Kubernetes | source matches `helm` or `k8s` |
   | Terraform | source ends with `.tf` or id is `EV-DEP-terraform` |
   | GitHub Actions | source contains `.github/workflows/` |
   | AWS | id matches `aws-sdk` or `@aws-sdk`, or source matches `aws` |
   | Redis | id or source matches `redis` |
   | PostgreSQL | id matches `pg`, `postgres`, `sequelize`, `prisma`, or `typeorm` |
   | MongoDB | id matches `mongo` or `mongoose` |
   | TypeScript | type=file, source ends with `.ts` or `.tsx` |
   | JavaScript | type=file, source ends with `.js` or `.jsx` |
   | Python | type=file, source ends with `.py` |
   | Go | type=file, source ends with `.go` |
   | Rust | type=file, source ends with `.rs` |
   | Java | type=file, source ends with `.java` |
   | React | id matches `react`, or type=file + source ends with `.tsx` |
   | Next.js | id matches `next`, or source is `next.config.js`/`next.config.mjs` |
   | Express | id matches `express` |
   | FastAPI | id matches `fastapi` |
   | GraphQL | id matches `graphql` or `apollo`, or source ends with `.graphql` |
   | Code Review | type=pull_request |
   | Collaboration | type=pull_request |

3. **Static quality analysis (all skills):**
   - Run `analyzeStaticQuality()` on all evidence types (file, dependency, config, commit, snippet, PR).
   - Produces `static_confidence` for every detected skill.
   - Dependency/config-only skills receive a conservative cap (≤ 0.5).
   - File ownership, tests, CI, linting, and type checking boost scores.

4. **Review gating (selective LLM review):**
   - Run `decideSkillReview()` to determine which skills warrant Claude code review.
   - High-value skills (languages, frameworks, infrastructure, practices) are reviewed at mid-range confidence.
   - Skills with strong static confidence and abundant evidence are skipped.
   - Skills with too-weak evidence are skipped.
   - Budget-constrained: `--max-review-tokens` limits total LLM spend.
   - `--dry-run` shows the review/skip split without making LLM calls.

5. **Code review by Claude (selected skills only):**
   - For each skill selected for review, build a compact evidence digest (summary lines + code snippets).
   - Group skills with file overlap; each skill gets its own digest section in the grouped prompt.
   - Claude scores proficiency:
     - 0.9–1.0: Expert  |  0.7–0.89: Proficient  |  0.5–0.69: Familiar  |  below 0.5: Beginner
   - Results are cached per-skill (keyed by digest payload hash, prompt version, model).

6. **Confidence merge:**
   - LLM-reviewed skills: `confidence = static_confidence * 0.35 + llm_confidence * 0.65`
   - Static-only skills: `confidence = static_confidence`
   - `inferred_by`: `"llm"` if LLM participated, `"static"` otherwise.
   - `review_decision`: `"static-only"`, `"llm-reviewed"`, or `"cached-llm"`.

7. **Write updated manifest** back to `.skillproof/resume-manifest.json`.

8. **Report** all skills with confidence, provenance, and review/static/cached breakdown.

### skillproof-render

Generate a professional resume from the manifest.

1. **Determine locale:**
   - If arguments were provided (e.g., `zh-TW`, `en-US`, `ja`), use that.
   - Otherwise ask: "What language should the resume be generated in? (e.g., en-US, zh-TW, ja, ko)"

2. **Collect optional personal info:**
   - Ask: "Would you like to include a personal introduction or work experience? (Type your info, or 'skip')"

3. **Read** `.skillproof/resume-manifest.json`.

4. **Generate resume content** in the target locale:
   - Write in the target language, following that culture's resume conventions.
   - Keep technical skill names in English (TypeScript, Node.js, etc.).
   - Convert confidence scores:
     - 0.9–1.0 → Expert / 精通 / エキスパート
     - 0.7–0.89 → Proficient / 熟練 / 上級
     - 0.5–0.69 → Familiar / 熟悉 / 中級
     - below 0.5 → Beginner / 初學 / 初級
   - Do NOT fabricate skills or experiences not in the manifest.
   - Do NOT include evidence IDs in the resume body.
   - Use the `strengths` and `reasoning` fields from each skill to describe what the developer actually did with each technology. Be specific and grounded in the code review evidence.
   - Integrate personal info naturally if provided.
   - Output format: Markdown.

5. **Assemble the verification block:**
   - Compute manifest hash:
     ```bash
     node -e "const c=require('crypto'),m=JSON.parse(require('fs').readFileSync('.skillproof/resume-manifest.json','utf8'));m.signatures=[];const s=JSON.stringify(function k(o){if(o===null||typeof o!=='object')return o;if(Array.isArray(o))return o.map(k);const r={};for(const key of Object.keys(o).sort())r[key]=k(o[key]);return r}(m));process.stdout.write(c.createHash('sha256').update(s).digest('hex'))"
     ```
   - Append to resume:
     ```
     ---

     ## SkillProof Verification

     This resume is backed by cryptographic evidence from source code analysis.

     - **Evidence items:** {count}
     - **Skills verified:** {count}
     - **Repository:** {repo url or "local"}
     - **Commit:** {first 7 chars of head_commit}
     - **Generated:** {generated_at}

     <details>
     <summary>Technical Verification Details</summary>

     - **Manifest hash:** {hash}
     - **Signature algorithm:** Ed25519
     - **Signer:** {signer}
     - **Public key fingerprint:** {first 16 chars of public_key}
     - **Signed at:** {timestamp}
     - **Verification status:** VALID

     To verify: `skillproof verify bundle.zip`

     </details>
     ```
   - If `signatures` is empty, replace the `<details>` block with: `> ⚠️ Unsigned — run the skillproof-sign procedure first to add cryptographic proof.`

6. **Ask output format:** Use AskUserQuestion to present a selection list (do NOT ask the user to type):
   - md (default)
   - pdf
   - png
   - jpeg

7. **Ask output path:** Use AskUserQuestion to ask the user where to save the file. Default: `./resume.<ext>` (based on chosen format). The user may specify a custom directory or filename.

8. **Write** the resume to the chosen output path using the Write tool and show preview.
   - For `md`: Write directly and show full preview.
   - For other formats: Requires Chrome. Use puppeteer or a markdown-to-X converter.

### skillproof-sign

Sign the manifest with Ed25519.

1. **Check for existing keys** at `.skillproof/keys/candidate.key` and `.skillproof/keys/candidate.pub`.

2. **Generate keys if missing:**
   ```bash
   node -e "
   const crypto=require('crypto'),fs=require('fs'),path=require('path');
   const dir='.skillproof/keys';
   fs.mkdirSync(dir,{recursive:true});
   const{publicKey,privateKey}=crypto.generateKeyPairSync('ed25519',{
     publicKeyEncoding:{type:'spki',format:'pem'},
     privateKeyEncoding:{type:'pkcs8',format:'pem'}
   });
   fs.writeFileSync(path.join(dir,'candidate.pub'),publicKey);
   fs.writeFileSync(path.join(dir,'candidate.key'),privateKey,{mode:0o600});
   console.log('Generated Ed25519 key pair');
   "
   ```

3. **Sign the manifest:**
   ```bash
   npx skillproof sign
   ```
   The CLI handles:
   - Computing `file_hashes` for any resume files present (resume.md, .pdf, .png, etc.)
   - Writing `file_hashes` into the manifest before signing
   - Generating or loading Ed25519 keys
   - Signing the canonical manifest (including `file_hashes`) with Ed25519
   - Enforcing 0o600 permissions on private key

   > **Important:** Run sign AFTER rendering resume files so `file_hashes` covers all output formats.

4. **Confirm** to user that the manifest has been signed.

### skillproof-pack

Create a distributable bundle.

> **Important:** Run `skillproof sign` AFTER rendering resume files. The sign step automatically computes `file_hashes` for all resume files and includes them in the signed manifest. This ensures verification covers file integrity.

1. **Create verification.json (informational) and bundle:**
   ```bash
   npx skillproof pack
   ```
   The CLI handles:
   - Reading the signed manifest (which already contains `file_hashes`)
   - Creating `verification.json` for human reference
   - Bundling all resume files, manifest, and verification into `bundle.zip`

2. **Confirm** the bundle was created and report its size.

### skillproof-verify

Verify a bundle's authenticity.

> **Security model:** Verification uses `manifest.file_hashes` (covered by Ed25519 signature), NOT `verification.json`. If `file_hashes` is missing from the signed manifest but resume files exist in the bundle, verification fails.

1. **Run verification:**
   ```bash
   npx skillproof verify bundle.zip
   ```
   The CLI handles:
   - Zip Slip protection (validates entries before extraction)
   - Signature verification against canonical manifest
   - File integrity check using signed `manifest.file_hashes`
   - Reports tampered files and missing hash coverage

2. **Report** verification results to user.
