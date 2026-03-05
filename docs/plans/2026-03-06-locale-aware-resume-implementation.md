# Locale-Aware LLM Resume Generation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modify the `resume-render` skill procedure so Claude generates a full resume in the user's chosen language with a VeriResume verification block.

**Architecture:** Two files changed — the skill procedure (`SKILL.md`) and the slash command definition (`commands/resume-render.md`). No CLI code changes. The skill reads the manifest, collects user input (locale + optional bio), generates resume content via LLM, assembles a fixed-format verification block, and writes `resume.md`.

**Tech Stack:** Claude Code skills (Markdown procedure files), no additional dependencies.

---

### Task 1: Update the resume-render slash command

**Files:**
- Modify: `commands/resume-render.md`

**Step 1: Edit the command file**

Replace the entire content of `commands/resume-render.md` with:

```markdown
description: Generate a locale-aware resume from verified skills
disable-model-invocation: false

Invoke the veriresume:resume skill and follow the "resume-render" procedure exactly as presented to you

ARGUMENTS: {{args}}
```

Key changes:
- `disable-model-invocation` changed from `true` to `false` (LLM now drives generation)
- Added `ARGUMENTS: {{args}}` to pass through the locale parameter (e.g., `/resume-render zh-TW`)

**Step 2: Verify the change**

Read the file and confirm:
- `disable-model-invocation: false` is present
- `ARGUMENTS: {{args}}` is at the end

**Step 3: Commit**

```bash
git add commands/resume-render.md
git commit -m "feat(render): enable LLM invocation and pass locale argument"
```

---

### Task 2: Rewrite the resume-render procedure in SKILL.md

**Files:**
- Modify: `skills/resume/SKILL.md` (replace only the `### resume-render` section)

**Step 1: Read the current SKILL.md**

Read `skills/resume/SKILL.md` and locate the `### resume-render` section (lines will vary). Note the exact text boundaries — from `### resume-render` to the line before the next `###` heading.

**Step 2: Replace the resume-render section**

Replace the existing `### resume-render` section with the following:

```markdown
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
```

**Step 3: Read SKILL.md and verify**

Read `skills/resume/SKILL.md` and confirm:
- The `### resume-render` section contains all 6 steps
- Other sections (`resume-scan`, `resume-infer`, `resume-sign`, `resume-pack`, `resume-verify`, `resume-all`) are unchanged

**Step 4: Commit**

```bash
git add skills/resume/SKILL.md
git commit -m "feat(render): rewrite resume-render procedure for locale-aware LLM generation"
```

---

### Task 3: Smoke test the full flow

**Step 1: Run the resume-render command manually**

Simulate what the skill does by reading the manifest and verifying the data is accessible:

```bash
cat .veriresume/resume-manifest.json | head -20
```

Confirm the manifest exists and has `author`, `skills`, `evidence`, `signatures` fields.

**Step 2: Test the slash command**

Run `/resume-render zh-TW` in Claude Code. Verify:
- Claude does NOT ask for locale (it was provided as argument)
- Claude asks about personal info
- Claude generates a Chinese resume with English skill names
- VeriResume verification block appears at the bottom with correct data
- `resume.md` is written

**Step 3: Test without locale argument**

Run `/resume-render` in Claude Code. Verify:
- Claude asks which language to use
- Flow proceeds as above after answering

**Step 4: Test with unsigned manifest**

Remove signatures from manifest temporarily, run `/resume-render en-US`. Verify:
- Verification block shows the unsigned warning instead of technical details

**Step 5: Commit final state**

```bash
git add resume.md
git commit -m "test: verify locale-aware resume generation with zh-TW"
```
