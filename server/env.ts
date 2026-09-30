import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Working-directory values precede repository defaults. Shell values always win. */
export function loadEnvironment() {
  const explicit = process.env.TESTPAQ_ENV_FILE;
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  // Compiled modules live in dist-server/server; source modules live in server.
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const root = existsSync(join(sourceRoot, "package.json")) ? sourceRoot : repositoryRoot;
  const paths = explicit ? [resolve(explicit)] : [...new Set([join(process.cwd(), ".env"), join(root, ".env")])];
  for (const path of paths) {
    if (existsSync(path)) process.loadEnvFile(path);
    else if (explicit) throw new Error("TESTPAQ_ENV_FILE does not point to an existing file.");
  }
}

export function warnMissingKey() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.warn(
      "WARNING: OPENAI_API_KEY is missing. AI analysis is unavailable; manual features still work. Add the key to .env and restart Testpaq.",
    );
  }
}
