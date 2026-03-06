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
2. Run static inference:
   ```bash
   node packages/veriresume-cli/dist/index.js infer-skills
   ```
3. Read the manifest at `.veriresume/resume-manifest.json`.
4. Analyze the evidence and skills already inferred. Use your reasoning to identify additional skills not caught by static signals:
   - Look at architecture patterns (microservices, monolith, event-driven)
   - Look at testing practices (TDD, integration tests, e2e)
   - Look at code quality practices (linting, formatting, CI/CD)
   - Assign confidence scores (0.0-1.0) based on strength of evidence
5. Update the manifest with any additional LLM-inferred skills (set `inferred_by: "llm"`).
6. Write the updated manifest back to `.veriresume/resume-manifest.json`.
7. Report all skills found to the user.

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

6. **Write and preview:**
   - Combine the generated resume content + verification block.
   - Write the combined output to `resume.md` in the repo root.
   - Show the user a full preview of the generated resume.

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

1. resume-scan
2. resume-infer
3. resume-render
4. resume-sign
5. resume-pack
6. resume-verify

Report a summary after each step. If any step fails, stop and report the error.
