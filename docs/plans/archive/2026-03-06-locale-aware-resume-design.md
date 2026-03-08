# Locale-Aware LLM Resume Generation

## Summary

Modify the `resume-render` skill procedure so that Claude reads the SkillProof manifest and generates a full resume in the user's chosen language, with an optional personal bio section and a fixed-format SkillProof verification block at the bottom.

## Approach

**Option chosen: Modify existing resume-render skill (Option A)**

- The skill (not the CLI) drives LLM-based resume generation
- CLI `render` command remains as a no-LLM English fallback
- No new files, no new dependencies

## Flow

1. User runs `/skillproof-render [locale]`
2. If no locale argument, ask the user which language to use
3. Ask if the user wants to attach personal info (bio, work experience, etc.)
4. Read `.skillproof/skillproof-manifest.json`
5. Claude generates resume content in target language based on manifest + optional personal info
6. Assemble fixed-format SkillProof verification block from manifest data
7. Combine: resume content + verification block
8. Write to `resume.md`, show preview

## LLM Generation Guidelines

- Write in target language, following that language's resume conventions
- Keep technical skill names in English (TypeScript, Node.js, etc.)
- Convert confidence scores to human-friendly descriptions (1.0 → Expert, 0.7 → Familiar)
- Do not fabricate skills or experiences not present in manifest
- Integrate user-provided personal info naturally if provided
- Do not include evidence IDs in the resume body
- Markdown output; structure decided by LLM per language culture conventions, but must include a skills section

## SkillProof Verification Block

Fixed format, not LLM-generated. Assembled from manifest data:

```markdown
---

## SkillProof Verification

This resume is backed by cryptographic evidence from source code analysis.

- **Evidence items:** {count}
- **Skills verified:** {count}
- **Repository:** {repo_url}
- **Commit:** {head_commit_short}
- **Generated:** {generated_at}

<details>
<summary>Technical Verification Details</summary>

- **Manifest hash:** {hash}
- **Signature algorithm:** Ed25519
- **Signer:** {signer}
- **Public key fingerprint:** {fingerprint}
- **Signed at:** {timestamp}
- **Verification status:** VALID

To verify: `skillproof verify bundle.zip`

</details>
```

If manifest is unsigned (empty signatures), omit signature fields and show: "Unsigned — run `/skillproof-sign` first".

## Files to Modify

| File | Change |
|------|--------|
| `skills/resume/SKILL.md` | Rewrite `resume-render` procedure with locale handling, personal info collection, LLM generation guidelines, and verification block assembly |
| `commands/skillproof-render.md` | Remove `disable-model-invocation: true`, support locale argument |

## Files NOT Modified

- `packages/skillproof/src/commands/render.ts` — kept as no-LLM English fallback
- `commands/skillproof-all.md` / `resume-all` procedure — inherits new behavior automatically
- `skills/resume/templates/resume.modern.md` — unused but not deleted
