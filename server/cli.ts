#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { createApp } from "./app.js";
import { OpenAIAnalysisProvider } from "./provider.js";
import { TestpaqStore } from "./store.js";

const args = process.argv.slice(2);
const noOpen = args.includes("--no-open");
const portIndex = args.indexOf("--port");
const requestedPort = portIndex >= 0 ? Number(args[portIndex + 1]) : 0;
const isDev = Boolean(process.env.TESTPAQ_DEV_ORIGIN);
const sessionToken = process.env.TESTPAQ_SESSION_TOKEN || randomBytes(32).toString("base64url");
const dataDir = process.env.TESTPAQ_DATA_DIR || defaultDataDirectory();
const store = new TestpaqStore(join(dataDir, "testpaq.db"));
const provider = process.env.OPENAI_API_KEY
  ? new OpenAIAnalysisProvider(process.env.OPENAI_API_KEY, process.env.TESTPAQ_OPENAI_MODEL)
  : undefined;
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(currentDirectory, "../../dist");

if (!isDev && !existsSync(join(distDir, "index.html"))) {
  console.error("Testpaq UI is not built. Run `npm run build` first.");
  process.exit(1);
}

const server = serve({
  fetch: createApp({
    store,
    provider,
    sessionToken,
    allowedOrigin: process.env.TESTPAQ_DEV_ORIGIN || "self",
    distDir: isDev ? undefined : distDir,
    fixturesEnabled: process.env.TESTPAQ_ENABLE_FIXTURES === "1",
  }).fetch,
  hostname: "127.0.0.1",
  port: requestedPort,
});

server.on("listening", async () => {
  const address = server.address();
  if (!address || typeof address === "string") return;
  const url = process.env.TESTPAQ_DEV_ORIGIN || `http://127.0.0.1:${address.port}`;
  // The random token is embedded in the served page, never printed or placed in the URL.
  console.log(`Testpaq is ready at ${url}`);
  console.log(`Local data: ${dataDir}`);
  if (!noOpen) await open(url);
});

const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function defaultDataDirectory() {
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Testpaq");
  if (platform() === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Testpaq");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "testpaq");
}
