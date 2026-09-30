// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnvironment, warnMissingKey } from "./env";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});
function envFile(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "testpaq-env-"));
  dirs.push(dir);
  const file = join(dir, ".env");
  writeFileSync(file, content);
  vi.stubEnv("TESTPAQ_ENV_FILE", file);
  return file;
}

describe("environment loading", () => {
  it("loads a .env key and quoted model before provider construction", () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("TESTPAQ_OPENAI_MODEL", undefined);
    envFile('OPENAI_API_KEY="test-only-key"\nTESTPAQ_OPENAI_MODEL="gpt-5-mini"\n');
    loadEnvironment();
    expect(process.env.OPENAI_API_KEY).toBe("test-only-key");
    expect(process.env.TESTPAQ_OPENAI_MODEL).toBe("gpt-5-mini");
  });
  it("preserves explicitly exported shell configuration", () => {
    vi.stubEnv("OPENAI_API_KEY", "shell-key");
    envFile("OPENAI_API_KEY=file-key\n");
    loadEnvironment();
    expect(process.env.OPENAI_API_KEY).toBe("shell-key");
  });
  it("warns on missing or blank keys without printing credentials", () => {
    vi.stubEnv("OPENAI_API_KEY", "  ");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnMissingKey();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("OPENAI_API_KEY is missing"));
  });
});
