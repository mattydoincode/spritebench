import fs from "node:fs";
import path from "node:path";

const API_KEY_NAMES = ["OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPENAI_APIKEY"];

let cachedDotEnv: Record<string, string> | null = null;

function envFile(): string {
  return path.join(process.cwd(), ".env.local");
}

function readDotEnv(): Record<string, string> {
  if (cachedDotEnv) return cachedDotEnv;

  const parsed: Record<string, string> = {};

  for (const name of [".env", ".env.local"]) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;

    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

      const eq = line.indexOf("=");
      if (eq <= 0) continue;

      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      parsed[key] = value;
    }
  }

  cachedDotEnv = parsed;
  return parsed;
}

export function openAiApiKey(): string {
  const dotEnv = readDotEnv();

  for (const name of API_KEY_NAMES) {
    const value = process.env[name] ?? dotEnv[name];
    if (value && value.trim().length > 0) return value.trim();
  }

  throw new Error(`No OpenAI key found. Set ${API_KEY_NAMES[0]} in ${envFile()} or the environment.`);
}

export function hasOpenAiApiKey(): boolean {
  try {
    openAiApiKey();
    return true;
  } catch {
    return false;
  }
}
