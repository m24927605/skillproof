import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface SkillProofConfig {
  anthropic_api_key?: string;
}

function getConfigPath(cwd: string): string {
  return path.join(cwd, ".skillproof", "config.json");
}

export async function readConfig(cwd: string): Promise<SkillProofConfig> {
  try {
    const content = await readFile(getConfigPath(cwd), "utf8");
    return JSON.parse(content) as SkillProofConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(cwd: string, config: SkillProofConfig): Promise<void> {
  const configPath = getConfigPath(cwd);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export async function resolveApiKey(cwd: string): Promise<string | null> {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  const config = await readConfig(cwd);
  if (config.anthropic_api_key) return config.anthropic_api_key;

  return null;
}
