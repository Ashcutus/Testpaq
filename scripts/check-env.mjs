import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const path = process.env.TESTPAQ_ENV_FILE || fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(path)) process.loadEnvFile(path);
else if (process.env.TESTPAQ_ENV_FILE) throw new Error("TESTPAQ_ENV_FILE does not point to an existing file.");
if (!process.env.OPENAI_API_KEY?.trim())
  console.warn("WARNING: OPENAI_API_KEY is missing. Add it to .env for AI analysis. Manual features remain available.");
