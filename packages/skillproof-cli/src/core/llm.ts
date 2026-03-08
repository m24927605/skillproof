import Anthropic from "@anthropic-ai/sdk";
import type { Manifest } from "../types/manifest.ts";
import { LLM_MODEL } from "./review-cache.ts";

export interface PromptMessages {
  systemMessage: string;
  userMessage: string;
}

export interface DisplayOverrides {
  displayName?: string;
  contactEmail?: string;
}

export function buildPromptMessages(
  manifest: Manifest,
  locale: string,
  personalInfo: string | null,
  display?: DisplayOverrides,
): PromptMessages {
  const skills = [...manifest.skills].sort((a, b) => b.confidence - a.confidence);
  const commitCount = manifest.evidence.filter((e) => e.type === "commit").length;
  const fileCount = manifest.evidence.filter((e) => e.type === "file").length;

  const systemMessage = `You are a professional resume writer. Based on the verified skill data provided, write a professional resume in ${locale}.

Rules:
- Write in the target language, following that culture's resume conventions.
- Keep technical skill names in English (TypeScript, Node.js, etc.).
- Convert confidence scores to human-friendly descriptions in the target language:
  - 0.9–1.0: Expert level
  - 0.7–0.89: Proficient level
  - 0.5–0.69: Familiar level
  - Below 0.5: Beginner level
- Use the provided strengths and assessment to describe what the developer actually did with each technology. Be specific and grounded in the evidence.
- Do NOT fabricate skills or experiences not present in the data.
- Do NOT include evidence IDs.
- If personal info is provided, integrate it naturally.
- Output pure Markdown only. No code fences around the output.`;

  const skillLines = skills
    .map((s) => {
      let line = `- ${s.name} (confidence: ${s.confidence}, evidence count: ${s.evidence_ids.length}, inferred by: ${s.inferred_by})`;
      if (s.strengths && s.strengths.length > 0) {
        line += `\n  Strengths: ${s.strengths.join("; ")}`;
      }
      if (s.reasoning) {
        line += `\n  Assessment: ${s.reasoning}`;
      }
      return line;
    })
    .join("\n");

  const authorName = display?.displayName || manifest.author.name;
  const authorEmail = display?.contactEmail || manifest.author.email;

  const userMessage = `## Author
${authorName} | ${authorEmail}

## Verified Skills (sorted by confidence)
${skillLines}

## Evidence Statistics
- Total evidence items: ${manifest.evidence.length}
- Commits analyzed: ${commitCount}
- Files scanned: ${fileCount}

## Personal Info
${personalInfo || "None"}

Please generate the resume.`;

  return { systemMessage, userMessage };
}

export async function generateResume(
  apiKey: string,
  manifest: Manifest,
  locale: string,
  personalInfo: string | null,
  display?: DisplayOverrides,
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const { systemMessage, userMessage } = buildPromptMessages(manifest, locale, personalInfo, display);

  const response = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: 4096,
    system: systemMessage,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude API");
  }
  return textBlock.text;
}
