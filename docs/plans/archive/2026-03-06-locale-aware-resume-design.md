# Locale-Aware LLM Resume Generation

## Summary

Modify the `resume-render` skill procedure so that Claude reads the VeriResume manifest and generates a full resume in the user's chosen language, with an optional personal bio section and a fixed-format VeriResume verification block at the bottom.

## Approach

**Option chosen: Modify existing resume-render skill (Option A)**

- The skill (not the CLI) drives LLM-based resume generation
- CLI `render` command remains as a no-LLM English fallback
- No new files, no new dependencies

## Flow

1. User runs `/resume-render [locale]`
2. If no locale argument, ask the user which language to use
3. Ask if the user wants to attach personal info (bio, work experience, etc.)
4. Read `.veriresume/resume-manifest.json`
5. Claude generates resume content in target language based on manifest + optional personal info
6. Assemble fixed-format VeriResume verification block from manifest data
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

## VeriResume Verification Block

Fixed format, not LLM-generated. Assembled from manifest data:

```markdown
---

## VeriResume Verification

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

To verify: `veriresume verify bundle.zip`

</details>
```

If manifest is unsigned (empty signatures), omit signature fields and show: "Unsigned — run `/resume-sign` first".

## Files to Modify

| File | Change |
|------|--------|
| `skills/resume/SKILL.md` | Rewrite `resume-render` procedure with locale handling, personal info collection, LLM generation guidelines, and verification block assembly |
| `commands/resume-render.md` | Remove `disable-model-invocation: true`, support locale argument |

## Files NOT Modified

- `packages/veriresume-cli/src/commands/render.ts` — kept as no-LLM English fallback
- `commands/resume-all.md` / `resume-all` procedure — inherits new behavior automatically
- `skills/resume/templates/resume.modern.md` — unused but not deleted
