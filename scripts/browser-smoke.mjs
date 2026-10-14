/* global document, innerWidth */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { serve } from "@hono/node-server";
import { chromium } from "playwright";
import { createApp } from "../dist-server/server/app.js";
import { TestpaqStore } from "../dist-server/server/store.js";
import { newTestCase } from "../dist-server/src/shared/test-cases.js";
import { makeFixture } from "../dist-server/server/fixture.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "testpaq-browser-"));
const store = new TestpaqStore(join(directory, "testpaq.db"));
const group = store.saveGroup("Fundraising platform");
const item = { ...makeFixture(), groupId: group.id };
item.testCases = [
  {
    ...newTestCase(item, item.scenarios[0]),
    title: "Owner hides amount",
    destinations: { ...item.scenarios[0].destinations },
    steps: [
      {
        id: crypto.randomUUID(),
        action: "Choose Hide amount",
        data: "Campaign owned by signed-in user",
        expectedResult: "The campaign amount is hidden",
      },
    ],
    review: "accepted",
  },
];
store.save(item);
store.save({ ...makeFixture(), id: crypto.randomUUID(), title: "Campaign sharing permissions", groupId: group.id });
const providerFor = (model) => ({
  name: "OpenAI",
  model,
  withModel: providerFor,
  listModels: async () => ["gpt-5-mini", "gpt-4.1"],
  checkAccess: async () => undefined,
  generateCases: async (input) => ({
    testCases: [
      {
        clientId: "reload",
        title: "Hidden amount stays hidden after reload",
        objective: "Verify saved visibility after refresh",
        preconditions: "Campaign owner is signed in and the campaign amount is visible.",
        postconditions: "Restore the campaign amount to visible.",
        unknowns: [],
        steps: [
          {
            action: "Open the owner's campaign page",
            data: "Existing campaign owned by the signed-in user",
            expectedResult: "Campaign amount is visible",
          },
          { action: "Choose to hide the amount", data: "", expectedResult: "Amount is hidden on the campaign page" },
          { action: "Reload the campaign page", data: "", expectedResult: "Amount remains hidden" },
        ],
      },
      {
        clientId: "reader",
        title: "Anonymous reader sees no hidden campaign amount",
        objective: "Verify the visitor view of the owner's choice",
        preconditions: "Campaign owner has hidden the amount.",
        postconditions: "Restore campaign visibility after the review.",
        unknowns: [],
        steps: [
          {
            action: "Open the campaign in a signed-out browser session",
            data: "Campaign with amount hidden by the owner",
            expectedResult: "Campaign loads without displaying the amount",
          },
          { action: "Reload the page", data: "", expectedResult: "Amount is still hidden" },
        ],
      },
    ]
      .slice(0, input.targetCaseId ? 1 : 2)
      .map((value) =>
        input.targetCaseId
          ? { ...value, title: "Clarified campaign visibility case", objective: "Verify the current clarified visibility scope" }
          : value,
      ),
  }),
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
let page;
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const capture = async (name) => {
    if (gallery) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(root, `docs/gallery/${name}.png`), fullPage: name === "mobile-export" });
    }
  };
  await page.goto(url);
  await page.getByRole("button", { name: /^Campaign amount visibility/ }).waitFor();
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
  await page.getByRole("button", { name: /^Test cases/ }).click();
  await page.getByRole("button", { name: "Accept current scope", exact: true }).click();
  await page.getByRole("button", { name: "Draft test cases with AI", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Draft test cases", exact: true }).click();
  await page.locator(".case-list-item").nth(2).waitFor();
  assert.equal(await page.locator(".case-list-item").count(), 3);
  assert.equal(await page.locator(".test-case-card").count(), 1);
  // Existing case stays accepted; newly generated cases require explicit review.
  await page.locator(".case-list-item").nth(1).click();
  await page.getByRole("button", { name: "Accept and review next", exact: true }).click();
  assert.equal(await page.getByLabel("Test case title").inputValue(), "Anonymous reader sees no hidden campaign amount");
  await page.getByRole("button", { name: "Accept case", exact: true }).click();
  // Keep the detailed generated case visible in the gallery.
  await page.locator(".case-list-item").nth(1).click();
  await capture("test-cases");
  await page.getByRole("heading", { name: "Export accepted tests", exact: true }).waitFor();
  await page.getByRole("button", { name: "Download Qase CSV" }).waitFor();
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Qase CSV" }).click();
  const download = await downloadPending;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString();
  assert.ok(csv.startsWith("v2.id,title,"));
  assert.ok(csv.includes("to-be-automated"));
  assert.ok(csv.includes("Hidden amount stays hidden after reload"));
  assert.ok(csv.includes("Anonymous reader sees no hidden campaign amount"));
  assert.ok(csv.includes('3. ""Reload the campaign page""'));
  assert.ok(!csv.includes("Keyboard user can find"));
  const manualPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download manual cases", exact: true }).click();
  const manualStream = await (await manualPending).createReadStream();
  let manual = "";
  for await (const chunk of manualStream) manual += chunk.toString();
  assert.ok(manual.includes("Owner hides amount"));
  assert.ok(manual.includes("Expected:"));
  await page.getByRole("button", { name: "Coverage brief & handoff", exact: true }).click();
  await capture("qase-export");
  await page.getByRole("button", { name: /^Test cases/ }).click();
  await page.locator(".case-list-item").nth(0).click();
  await page.getByRole("button", { name: "Suggest case update with AI", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Suggest update", exact: true }).click();
  await page.getByRole("button", { name: "Apply proposed update", exact: true }).waitFor();
  if (gallery) await page.locator(".revision-comparison").screenshot({ path: join(root, "docs/gallery/case-update.png") });
  assert.equal(store.get(item.id).testCases[0].title, "Owner hides amount");
  await page.getByRole("button", { name: "Apply proposed update", exact: true }).click();
  await page.getByRole("button", { name: "Accept case", exact: true }).first().click();
  await page.getByRole("button", { name: "Mark completed" }).click();
  await page.getByRole("button", { name: "Complete review", exact: true }).click();
  await page.getByRole("button", { name: "Reopen Testpaq" }).waitFor();
  await page.getByRole("button", { name: "Scenario review", exact: false }).click();
  await page.getByRole("button", { name: "Expand scenario" }).first().click();
  assert.equal(await page.getByLabel("Scenario title").getAttribute("readonly"), "");
  await capture("completed");
  await page.getByRole("button", { name: /^Test cases/ }).click();
  assert.ok(await page.getByLabel("Test case title").first().isDisabled());
  assert.ok(await page.getByLabel("Coverage output").isEnabled());
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
  // Single acceptance offers immediate creation without making an AI request.
  await page.getByRole("button", { name: /Scenario review/ }).click();
  const proposalRow = page.locator(".scenario-row.review-proposed").first();
  await proposalRow.getByRole("button", { name: "Accept scenario", exact: true }).click();
  await page.getByRole("dialog", { name: "Coverage accepted — create test cases" }).waitFor();
  await capture("accept-create");
  await page.getByRole("button", { name: "Add manually", exact: true }).click();
  await page.getByLabel("Test case title").fill("Manual coverage from accepted suggestion");
  await page.getByLabel("Action", { exact: true }).fill("Carry out the selected behaviour");
  await page.getByRole("button", { name: "Accept case", exact: true }).click();
  assert.equal(await page.getByText("To be automated in Qase", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Ticket & requirements", exact: true }).click();
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page
    .getByLabel(/^Requirement /)
    .last()
    .fill("New manual requirement needs coverage");
  assert.ok(await page.getByRole("button", { name: "Suggest coverage for gaps", exact: true }).isVisible());
  await page.getByRole("button", { name: /^Questions/ }).click();
  await page
    .getByLabel(/^Answer to:/)
    .first()
    .fill("Confirmed by Product: test both reader and owner views.");
  await page.getByRole("button", { name: "Save answer", exact: true }).first().click();
  await page
    .getByRole("status", { name: "Question feedback actions" })
    .getByRole("button", { name: "Review affected cases", exact: true })
    .click();
  await page.getByText("Review revised scope", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Coverage brief & handoff", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Download Qase CSV", exact: true }).isDisabled());
  await page.getByRole("button", { name: /^Test cases/ }).click();
  for (let index = 0; index < (await page.locator(".case-list-item").count()); index++) {
    await page.locator(".case-list-item").nth(index).click();
    if (await page.getByRole("button", { name: "Accept current scope", exact: true }).count())
      await page.getByRole("button", { name: "Accept current scope", exact: true }).click();
  }
  await page.getByRole("button", { name: "Ticket & requirements", exact: true }).click();
  // UI remains usable in dark/mobile layouts.
  await page.getByRole("button", { name: "dark theme" }).click();
  await capture("dark-ticket");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Test cases/ }).click();
  assert.ok(await page.getByLabel("Test case title").first().isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole("button", { name: "Coverage brief & handoff", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Download Qase CSV" }).isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture("mobile-export");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "All Testpaqs", exact: true }).click();
  await page.getByLabel("Search Testpaqs").fill("no match at all");
  await page.getByRole("heading", { name: "No matching Testpaqs", exact: true }).waitFor();
  await page.getByLabel("Search Testpaqs").fill("");
  await page.getByRole("button", { name: `Duplicate ${item.title}`, exact: true }).waitFor();
  await page.getByRole("button", { name: `Duplicate ${item.title}`, exact: true }).click();
  await page.getByRole("heading", { name: `${item.title} (copy)`, exact: true }).waitFor();
  const copy = store.list().find((value) => value.title === `${item.title} (copy)`);
  assert.ok(copy);
  assert.ok(store.get(copy.id).testCases.every((value) => value.review === "proposed"));
  await page.getByRole("button", { name: "All Testpaqs", exact: true }).click();
  await page.getByRole("button", { name: `Archive ${copy.title}`, exact: true }).click();
  await page.getByLabel("Workspace view").selectOption("archived");
  await page.getByRole("button", { name: `Restore ${copy.title}`, exact: true }).waitFor();
  await page.getByRole("button", { name: `Restore ${copy.title}`, exact: true }).click();
  await page.getByRole("heading", { name: "No matching Testpaqs", exact: true }).waitFor();
  await page.getByLabel("Workspace view").selectOption("active");
  await page
    .locator(".work-row")
    .filter({ has: page.getByText(item.title, { exact: true }) })
    .click();
  await page.getByRole("button", { name: "Ticket & requirements", exact: true }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const generation = store.getSetting("workspace_generation");
  const restoreFile = join(directory, "restore.json");
  writeFileSync(restoreFile, JSON.stringify(store.backup()));
  const stale = await page.context().newPage();
  stale.on("pageerror", (error) => errors.push(error.message));
  await stale.goto(`${url}/#/testpaqs/${item.id}`);
  await stale.getByLabel("QA context").waitFor();
  await stale.route("**/api/testpaqs/*", (route) => (route.request().method() === "PUT" ? route.abort("failed") : route.continue()));
  await stale.getByLabel("QA context").fill("Unsaved stale-tab recovery text");
  await stale.getByText("Save failed", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Backup / restore", exact: true }).click();
  await page.getByLabel("Restore a Testpaq backup").setInputFiles(restoreFile);
  await page.getByRole("button", { name: "Replace workspace with selected backup", exact: true }).click();
  await page.getByRole("heading", { name: "Testpaqs", exact: true }).waitFor();
  await page
    .locator(".work-row")
    .filter({ has: page.getByText(item.title, { exact: true }) })
    .click();
  await page.getByLabel("Description").waitFor();
  await stale.getByRole("dialog", { name: "Workspace replaced — editing paused" }).waitFor();
  const recoveryPending = stale.waitForEvent("download");
  await stale.getByRole("button", { name: "Download retained drafts", exact: true }).click();
  const recoveryStream = await (await recoveryPending).createReadStream();
  let recovered = "";
  for await (const chunk of recoveryStream) recovered += chunk.toString();
  assert.ok(recovered.includes("Unsaved stale-tab recovery text"));
  assert.notEqual(store.get(item.id).ticket.qaContext, "Unsaved stale-tab recovery text");
  await stale.unroute("**/api/testpaqs/*");
  const denied = await stale.evaluate(
    async ({ generation, id }) =>
      (
        await fetch(`/api/testpaqs/${id}`, {
          method: "DELETE",
          headers: { "x-testpaq-session": "browser-fixture-token", "x-testpaq-workspace": generation },
        })
      ).status,
    { generation, id: item.id },
  );
  assert.equal(denied, 409);
  assert.ok(store.get(item.id));
  await stale.close();
  await page.getByRole("button", { name: /^Test cases/ }).click();
  await page.locator(".case-list-item").first().focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByLabel("Test case title").count(), 1);
  await page.getByRole("button", { name: "Next case", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByLabel("Test case title").inputValue(), "Hidden amount stays hidden after reload");
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: host rejection, autosave/refresh, one-to-many case drafting/review, multi-step Qase download, completion/inspection, model selection, backup, accept/create, Manual handoff, targeted revision comparison/application, feedback and new requirement prompts, one focused editor, remembered views, archive/duplicate, cross-tab restore/draft recovery, keyboard and dark/mobile layouts.",
  );
  if (gallery) console.log("Captured gallery in docs/gallery (synthetic data; no external API calls).");
} catch (error) {
  if (page) {
    writeFileSync("/tmp/testpaq-browser-failure.html", await page.content());
    await page.screenshot({ path: "/tmp/testpaq-browser-failure.png", fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
