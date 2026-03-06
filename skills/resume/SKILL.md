name: resume
description: Generate verifiable developer resumes from source code repositories

---

## Procedures

### resume-scan

1. Ensure the CLI is built:
   ```bash
   cd packages/veriresume-cli && npm run build
   ```
2. Run the scan command:
   ```bash
   node packages/veriresume-cli/dist/index.js scan
   ```
3. Report the results to the user: how many evidence items were found, broken down by type.

### resume-infer

1. Ensure the CLI is built.
2. Run the infer-skills command (this is interactive — it will estimate token cost and ask the user to choose Full or Sampled review mode):
   ```bash
   node packages/veriresume-cli/dist/index.js infer-skills
   ```
   The CLI will:
   - Detect skills from evidence and group eligible files (ownership > 50%)
   - Estimate token usage for Full vs Sampled review
   - Display cost estimates and prompt user to choose A (Full) or B (Sampled)
   - Require an Anthropic API key (from env, config, or interactive prompt)
   - Send code to Claude for quality review per skill
   - Write quality scores as skill confidence to manifest
3. Report all skills and their quality scores to the user.

### resume-render

1. **Determine locale:**
   - If arguments were provided (e.g., `zh-TW`, `en-US`, `ja`), use that as the locale.
   - If no argument was provided, ask the user: "What language should the resume be generated in? (e.g., en-US, zh-TW, ja, ko)"

2. **Collect optional personal info:**
   - Ask the user: "Would you like to include a personal introduction or work experience? These aren't in the code evidence but can enrich the resume. (Type your info, or 'skip' to continue)"
   - If the user provides text, store it for use in generation.
   - If the user says "skip" or equivalent, proceed without it.

3. **Read the manifest:**
   - Read `.veriresume/resume-manifest.json`.
   - Extract: `author`, `skills` (sorted by confidence descending), `evidence` summary (total count, commits count, files count), `repo`, `generated_at`, `signatures`.

4. **Generate resume content:**
   - Using the manifest data and optional personal info, write a professional resume in the target locale.
   - Follow these rules strictly:
     - Write in the target language, following that culture's resume conventions.
     - Keep technical skill names in English (TypeScript, Node.js, Ed25519, etc.).
     - Convert confidence scores to human-friendly descriptions:
       - 0.9–1.0 → Expert / 精通 / エキスパート (use target language)
       - 0.7–0.89 → Proficient / 熟練 / 上級
       - 0.5–0.69 → Familiar / 熟悉 / 中級
       - below 0.5 → Beginner / 初學 / 初級
     - Do NOT fabricate skills or experiences not in the manifest.
     - Do NOT include evidence IDs in the resume body.
     - If personal info was provided, integrate it naturally.
     - Output format is Markdown. Structure sections as appropriate for the target language's resume culture.

5. **Assemble the VeriResume verification block:**
   - Read the signature data from the manifest.
   - Append the following fixed-format block after the resume content (fill in values from manifest):

   ```
   ---

   ## VeriResume Verification

   This resume is backed by cryptographic evidence from source code analysis.

   - **Evidence items:** {evidence.length}
   - **Skills verified:** {skills.length}
   - **Repository:** {repo.url or "local"}
   - **Commit:** {repo.head_commit, first 7 chars}
   - **Generated:** {generated_at}

   <details>
   <summary>Technical Verification Details</summary>

   - **Manifest hash:** {compute SHA-256 of canonical manifest JSON, excluding signatures}
   - **Signature algorithm:** Ed25519
   - **Signer:** {signatures[0].signer}
   - **Public key fingerprint:** {first 16 chars of signatures[0].public_key}
   - **Signed at:** {signatures[0].timestamp}
   - **Verification status:** VALID

   To verify: `veriresume verify bundle.zip`

   </details>
   ```

   - If `signatures` is empty, replace the `<details>` block with: `> ⚠️ Unsigned — run /resume-sign first to add cryptographic proof.`

6. **Determine output format:**
   - Ask the user: "What format should the resume be exported in? (md, pdf, png, jpeg — default: md)"
   - If the user wants non-md format, Chrome must be installed (check with `doctor` command).

7. **Write and preview:**
   - Combine the generated resume content + verification block.
   - Run the render CLI command with the chosen locale and format:
     ```bash
     node packages/veriresume-cli/dist/index.js render <locale> --format <format>
     ```
   - Or, if format is `md` (default), write directly to `resume.md` and show a full preview.

### resume-sign

1. Ensure the CLI is built.
2. Run the sign command:
   ```bash
   node packages/veriresume-cli/dist/index.js sign
   ```
3. Confirm to the user that the manifest has been signed.

### resume-pack

1. Ensure the CLI is built.
2. Run the pack command:
   ```bash
   node packages/veriresume-cli/dist/index.js pack
   ```
3. Confirm the bundle.zip was created and list its contents.

### resume-verify

1. Ensure the CLI is built.
2. Run the verify command:
   ```bash
   node packages/veriresume-cli/dist/index.js verify bundle.zip
   ```
3. Report the verification results to the user.

### resume-all

Run all procedures in sequence:

1. **Choose scan mode:**
   - Ask the user: "How would you like to scan? (A) Current project only, (B) Multiple local projects, (C) GitHub remote repos"
   - **A — Current project:** Run `resume-scan` as normal (scan current directory).
   - **B — Multiple local projects:**
     - Ask the user for the parent directory path (e.g., `~/office-project`). Default: current directory.
     - Run `scan-multi` which will:
       1. Discover ALL git repositories under that directory and list them all in a checkbox prompt.
       2. User selects which repos to include.
       3. Collect and confirm author email addresses.
       4. Scan selected repos and merge evidence into one manifest.
     ```bash
     node packages/veriresume-cli/dist/index.js scan-multi --path <parent-dir>
     ```
   - **C — GitHub remote repos:**
     - Run `scan-multi --github` which will:
       1. Ask which sources to include (my repos, contributed repos, org repos).
       2. Fetch and list all repos for user to select.
       3. Clone, scan, and merge into one manifest.
     ```bash
     node packages/veriresume-cli/dist/index.js scan-multi --github
     ```
2. resume-infer
3. resume-render
4. resume-sign
5. resume-pack
6. resume-verify

Report a summary after each step. If any step fails, stop and report the error.
