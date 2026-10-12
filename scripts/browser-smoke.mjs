/* global document, innerWidth */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { serve } from "@hono/node-server";
import { chromium } from "playwright";
import { createApp } from "../dist-server/server/app.js";
import { TestpaqStore } from "../dist-server/server/store.js";
import { makeFixture } from "../dist-server/server/fixture.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "testpaq-browser-"));
const store = new TestpaqStore(join(directory, "testpaq.db"));
const group = store.saveGroup("Fundraising platform");
const item = { ...makeFixture(), groupId: group.id };
store.save(item);
store.save({ ...makeFixture(), id: crypto.randomUUID(), title: "Campaign sharing permissions", groupId: group.id });
const providerFor = (model) => ({
  name: "OpenAI",
  model,
  withModel: providerFor,
  listModels: async () => ["gpt-5-mini", "gpt-4.1"],
  checkAccess: async () => undefined,
  analyse: async (input) => ({
    requirements: input.requirements
      .filter((value) => value.active)
      .map((value) => ({ clientId: value.id, text: value.text, source: value.source })),
    scenarios: [],
    questions: [],
  }),
});
const server = serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: createApp({
    store,
    provider: providerFor("gpt-5-mini"),
    sessionToken: "browser-fixture-token",
    allowedOrigin: "self",
    distDir: join(root, "dist"),
  }).fetch,
});
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const port = server.address().port;
const url = `http://127.0.0.1:${port}`;
let browser;
const gallery = process.argv.includes("--gallery");
if (gallery) mkdirSync(join(root, "docs/gallery"), { recursive: true });
try {
  // Confirm Host rejection through a real HTTP request, not just in-process routing.
  const rejected = await new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: "/", headers: { host: `untrusted.example:${port}` } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(rejected, 403);
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    executablePath: process.env.TESTPAQ_BROWSER_PATH || undefined,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const capture = async (name) => {
    if (gallery) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(root, `docs/gallery/${name}.png`), fullPage: name === "mobile-export" });
    }
  };
  await page.goto(url);
  await page.getByRole("button", { name: /Campaign amount visibility/ }).waitFor();
  await capture("projects");
  await page.goto(`${url}/#/testpaqs/${item.id}`);
  await page.getByLabel("Description").waitFor();
  await capture("ticket");
  // Autosave, refresh disclosure and run history use a synthetic provider only.
  const description = item.ticket.description + "\n\nReview caching after the visibility preference changes.";
  await page.getByLabel("Description").fill(description);
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector(".save-state")?.textContent?.includes("Saved locally"));
  await page.getByRole("button", { name: "Refresh analysis", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Refresh analysis", exact: true }).click();
  await page.getByRole("button", { name: "Expand scenario" }).first().waitFor();
  await page.getByRole("button", { name: "Expand scenario" }).first().click();
  await capture("review");
  await page.getByRole("button", { name: "Coverage brief", exact: true }).click();
  await page.getByRole("button", { name: "Download Qase CSV" }).waitFor();
  await capture("qase-export");
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Qase CSV" }).click();
  const download = await downloadPending;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString();
  assert.ok(csv.startsWith("v2.id,title,"));
  assert.ok(csv.includes("to-be-automated"));
  assert.ok(!csv.includes("Keyboard user can find"));
  await page.getByRole("button", { name: "Mark completed" }).click();
  await page.getByRole("button", { name: "Reopen Testpaq" }).waitFor();
  await page.getByRole("button", { name: "Scenario review", exact: false }).click();
  await page.getByRole("button", { name: "Expand scenario" }).first().click();
  assert.equal(await page.getByLabel("Scenario title").getAttribute("readonly"), "");
  await capture("completed");
  await page.getByRole("button", { name: /Check OpenAI|OpenAI verified/ }).click();
  await page.getByLabel("Analysis model").fill("gpt-4.1");
  await page.getByRole("button", { name: "Save model", exact: true }).click();
  await page.getByRole("button", { name: "Save model", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('input[list="openai-models"]')?.value === "gpt-4.1");
  await page.getByRole("button", { name: "Check API access", exact: true }).waitFor();
  await capture("model-settings");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Backup / restore" }).click();
  const backupPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download workspace backup", exact: true }).click();
  const backupDownload = await backupPending;
  const backupStream = await backupDownload.createReadStream();
  let json = "";
  for await (const chunk of backupStream) json += chunk.toString();
  const backup = JSON.parse(json);
  assert.equal(backup.testpaqs.length, 2);
  assert.equal(backup.model, "gpt-4.1");
  assert.ok(backup.runs.length > 0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Reopen Testpaq" }).click();
  await page.getByRole("button", { name: "Mark completed" }).waitFor();
  await page.getByRole("button", { name: "Ticket & requirements", exact: true }).click();
  // UI remains usable in dark/mobile layouts.
  await page.getByRole("button", { name: "dark theme" }).click();
  await capture("dark-ticket");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Coverage brief", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Download Qase CSV" }).isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture("mobile-export");
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: host rejection, autosave/refresh, Qase download, completion/inspection, model selection, backup, dark/mobile layouts.",
  );
  if (gallery) console.log("Captured gallery in docs/gallery (synthetic data; no external API calls).");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
