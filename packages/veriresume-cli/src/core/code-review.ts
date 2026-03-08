import Anthropic from "@anthropic-ai/sdk";
import type { FileForReview } from "./token-estimate.ts";

export interface ReviewResult {
  skill: string;
  quality_score: number;
  reasoning: string;
  strengths: string[];
}

export function buildReviewPrompt(
  skill: string,
  files: FileForReview[],
): { systemMessage: string; userMessage: string } {
  const systemMessage = `You are a senior code reviewer. Review the provided code files and assess the author's proficiency in the specified skill.

Evaluate based on:
- Code quality and readability
- Error handling and edge cases
- Design patterns and architecture
- Best practices and conventions
- Type safety and correctness

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "skill": "<skill name>",
  "quality_score": <0.0 to 1.0>,
  "reasoning": "<brief explanation>",
  "strengths": ["<strength 1>", "<strength 2>"]
}

Score guide:
- 0.9-1.0: Expert — exceptional patterns, comprehensive error handling, production-grade
- 0.7-0.89: Proficient — solid code, good practices, minor improvements possible
- 0.5-0.69: Intermediate — functional but lacks polish, some anti-patterns
- 0.3-0.49: Beginner — works but significant quality issues
- 0.0-0.29: Novice — major issues, poor practices`;

  const fileContents = files
    .map((f) => `### ${f.path} (ownership: ${Math.round(f.ownership * 100)}%)\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  const userMessage = `## Skill: ${skill}\n\n## Code Files\n\n${fileContents}\n\nPlease review and rate the author's ${skill} proficiency.`;

  return { systemMessage, userMessage };
}

export function parseReviewResponse(response: string): ReviewResult {
  let jsonStr = response.trim();

  // Extract from markdown code block if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      skill: parsed.skill || "unknown",
      quality_score: Math.max(0, Math.min(1, Number(parsed.quality_score) || 0)),
      reasoning: parsed.reasoning || "",
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    };
  } catch {
    throw new Error(`Failed to parse code review response: ${response.slice(0, 200)}`);
  }
}

export async function reviewSkill(
  apiKey: string,
  skill: string,
  files: FileForReview[],
): Promise<ReviewResult> {
  const client = new Anthropic({ apiKey });
  const { systemMessage, userMessage } = buildReviewPrompt(skill, files);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemMessage,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`No text response for skill: ${skill}`);
  }

  return parseReviewResponse(textBlock.text);
}

export function buildGroupedReviewPrompt(
  skills: string[],
  files: FileForReview[],
): { systemMessage: string; userMessage: string } {
  const systemMessage = `You are a senior code reviewer. Review the provided code files and assess the author's proficiency in EACH of the specified skills independently.

Evaluate based on:
- Code quality and readability
- Error handling and edge cases
- Design patterns and architecture
- Best practices and conventions
- Type safety and correctness

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "reviews": [
    {
      "skill": "<skill name>",
      "quality_score": <0.0 to 1.0>,
      "reasoning": "<brief explanation>",
      "strengths": ["<strength 1>", "<strength 2>"]
    }
  ]
}

You MUST include a review entry for each of these skills: ${skills.join(", ")}

Score guide:
- 0.9-1.0: Expert — exceptional patterns, comprehensive error handling, production-grade
- 0.7-0.89: Proficient — solid code, good practices, minor improvements possible
- 0.5-0.69: Intermediate — functional but lacks polish, some anti-patterns
- 0.3-0.49: Beginner — works but significant quality issues
- 0.0-0.29: Novice — major issues, poor practices`;

  const fileContents = files
    .map((f) => `### ${f.path} (ownership: ${Math.round(f.ownership * 100)}%)\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  const userMessage = `## Skills to evaluate: ${skills.join(", ")}\n\n## Code Files\n\n${fileContents}\n\nPlease review and rate the author's proficiency for EACH skill listed above.`;

  return { systemMessage, userMessage };
}

export function parseGroupedReviewResponse(response: string): ReviewResult[] {
  let jsonStr = response.trim();

  // Extract from markdown code block if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed.reviews)) {
      throw new Error("Expected 'reviews' array in response");
    }
    return parsed.reviews.map((r: Record<string, unknown>) => ({
      skill: String(r.skill || "unknown"),
      quality_score: Math.max(0, Math.min(1, Number(r.quality_score) || 0)),
      reasoning: String(r.reasoning || ""),
      strengths: Array.isArray(r.strengths) ? r.strengths.map(String) : [],
    }));
  } catch {
    throw new Error(`Failed to parse grouped review response: ${response.slice(0, 200)}`);
  }
}

export async function reviewSkillGroup(
  apiKey: string,
  skills: string[],
  files: FileForReview[],
): Promise<ReviewResult[]> {
  if (skills.length === 1) {
    const result = await reviewSkill(apiKey, skills[0], files);
    return [result];
  }

  const client = new Anthropic({ apiKey });
  const { systemMessage, userMessage } = buildGroupedReviewPrompt(skills, files);

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024 * skills.length,
    system: systemMessage,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`No text response for skill group: ${skills.join(", ")}`);
  }

  return parseGroupedReviewResponse(textBlock.text);
}
