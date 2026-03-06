import readline from "node:readline";
import { checkbox } from "@inquirer/prompts";

export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function askYesNo(question: string): Promise<boolean> {
  const answer = await ask(`${question} (y/n): `);
  return answer.toLowerCase().startsWith("y");
}

export async function checkboxPrompt<T>(
  message: string,
  choices: { name: string; value: T; checked?: boolean }[]
): Promise<T[]> {
  return checkbox({ message, choices });
}
