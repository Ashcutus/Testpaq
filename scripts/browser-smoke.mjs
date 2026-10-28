/* global document, innerWidth, window */
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
import { makeFixture, reviewedFixtureCase } from "../dist-server/server/fixture.js";

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
  draftCases: async (input) => {
    const scenarioId = input.scenarios[0].id;
    const drafted = [
      {
        clientId: "reload",
        scenarioId,
        replacesCaseId: null,
        title: "Hidden amount stays hidden after reload",
        description: "Verify saved visibility after refresh",
        preconditions: "Campaign owner is signed in and the campaign amount is visible.",
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
        scenarioId,
        replacesCaseId: null,
        title: "Anonymous reader sees no hidden campaign amount",
        description: "Verify the visitor view of the owner's choice",
        preconditions: "Campaign owner has hidden the amount.",
        steps: [
          {
            action: "Open the campaign in a signed-out browser session",
            data: "Campaign with amount hidden by the owner",
            expectedResult: "Campaign loads without displaying the amount",
          },
          { action: "Reload the page", data: "", expectedResult: "Amount is still hidden" },
        ],
      },
    ];
    // Requested updates return one revision for the first requested case; otherwise two new cases.
    if (input.updateCaseIds.length)
      return {
        testCases: [
          {
            ...drafted[0],
            clientId: "update",
            replacesCaseId: input.updateCaseIds[0],
            scenarioId: input.testCases.find((value) => value.id === input.updateCaseIds[0]).scenarioId,
            title: "Clarified campaign visibility case",
            description: "Verify the current clarified visibility scope",
          },
        ],
      };
    return { testCases: drafted };
  },
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
    if (gallery || process.env.TESTPAQ_SCREENSHOT_DIR) {
      await page.evaluate(() => document.fonts.ready);
      await page.locator(".save-saving").waitFor({ state: "hidden" });
      if (name === "mobile-export") await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: process.env.TESTPAQ_SCREENSHOT_DIR
          ? join(process.env.TESTPAQ_SCREENSHOT_DIR, `${name}.png`)
          : join(root, `docs/gallery/${name}.png`),
        fullPage: name === "mobile-export",
      });
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
  // One Analyse action; the person chooses the scope and nothing runs until they confirm.
  await page.getByRole("button", { name: "Analyse", exact: true }).click();
  const analyseDialog = page.getByRole("dialog");
  await analyseDialog.getByRole("checkbox", { name: /Requirements, questions & coverage/ }).check();
  await capture("analyse");
  await analyseDialog.getByRole("checkbox", { name: /^Test cases/ }).uncheck();
  assert.equal(store.getRuns(item.id).length, 0);
  await analyseDialog.getByRole("button", { name: "Analyse", exact: true }).click();
  await analyseDialog.waitFor({ state: "hidden" });
  await page.getByText(/Analysis finished/).waitFor();
  assert.equal(store.getRuns(item.id).length, 1);
  // Analysis never navigates away or prompts for a follow-up.
  assert.equal(await page.getByLabel("Description").count(), 1);
  await page.getByRole("button", { name: /^Requirements & questions/ }).click();
  await capture("requirements");
  await page.getByRole("button", { name: /Coverage approval/ }).click();
  await page.getByRole("button", { name: "Expand scenario" }).first().waitFor();
  await page.getByRole("button", { name: "Expand scenario" }).first().click();
  await capture("review");
  await page.getByRole("button", { name: /^Test cases/ }).click();
  await page.getByRole("button", { name: "Accept current scope", exact: true }).click();
  await page.getByRole("button", { name: "Analyse", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Select none", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: new RegExp(item.scenarios[0].title) })
    .check();
  await page.getByRole("dialog").getByRole("button", { name: "Analyse", exact: true }).click();
  await page.locator(".case-list-item").nth(2).waitFor();
  assert.equal(await page.locator(".case-list-item").count(), 3);
  assert.equal(await page.locator(".case-editor").count(), 1);
  assert.equal(store.getRuns(item.id).length, 2);
  // Existing case stays accepted; newly generated cases require explicit review.
  await page.locator(".case-list-item").nth(1).click();
  await page.getByRole("button", { name: "Accept and review next", exact: true }).click();
  assert.equal(await page.getByLabel("Test case title").inputValue(), "Anonymous reader sees no hidden campaign amount");
  await page.getByRole("button", { name: "Accept case", exact: true }).click();
  // Keep the detailed generated case visible in the gallery.
  await page.locator(".case-list-item").nth(1).click();
  await capture("test-cases");
  await page.getByRole("button", { name: "Continue to handoff", exact: true }).click();
  await page.getByRole("heading", { name: "Manual test cases", exact: true }).waitFor();
  await page.getByRole("button", { name: "Download Qase CSV" }).waitFor();
  const downloadPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Qase CSV" }).click();
  const download = await downloadPending;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString();
  assert.ok(csv.startsWith("id,title,"));
  assert.ok(!csv.includes("v2.id"));
  assert.ok(csv.includes("to-be-automated"));
  assert.ok(csv.includes("Hidden amount stays hidden after reload"));
  assert.ok(csv.includes("Anonymous reader sees no hidden campaign amount"));
  assert.ok(csv.includes("3. Reload the campaign page"));
  // Only test content is exported: no Testpaq, ticket, requirement, rationale, ID or cleanup commentary.
  for (const leaked of ["Testpaq:", "Scenario ID", "Test case ID", "Rationale", "Requirements:", item.requirements[0].text])
    assert.ok(!csv.includes(leaked), `Qase CSV leaked ${leaked}`);
  assert.ok(!csv.includes("Keyboard user can find"));
  const manualPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download manual cases", exact: true }).click();
  const manualStream = await (await manualPending).createReadStream();
  let manual = "";
  for await (const chunk of manualStream) manual += chunk.toString();
  assert.ok(manual.includes("Owner hides amount"));
  assert.ok(manual.includes("Expected:"));
  for (const leaked of ["Case ID", "Coverage output", "Destinations", "Review:", "Open questions", "Risks"])
    assert.ok(!manual.includes(leaked), `Manual download leaked ${leaked}`);
  await page.getByRole("button", { name: "Coverage brief & handoff", exact: true }).click();
  await capture("qase-export");
  // Changed scope surfaces in the Analyse dialog; updates are proposed in the same single request.
  await page.getByRole("button", { name: "Initial ticket analysis", exact: true }).click();
  await page.getByLabel("QA context").fill("Focus on owner and reader views after the visibility preference changes.");
  await page.getByText("Saved locally", { exact: true }).waitFor();
  // The out-of-date marker is passive: it only annotates the Analyse button.
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: /^Analyse.*Out of date/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: /Requirements, questions & coverage/ })
    .uncheck();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: /^Test cases/ })
    .check();
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: /Also propose updates/ })
    .waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Analyse", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: /^Test cases/ }).click();
  await page.getByRole("button", { name: /Clarified campaign visibility case.*Proposed update/ }).click();
  await page.getByRole("button", { name: "Apply proposed update", exact: true }).waitFor();
  if (gallery) await page.locator(".revision-comparison").screenshot({ path: join(root, "docs/gallery/case-update.png") });
  assert.equal(store.get(item.id).testCases[0].title, "Owner hides amount");
  await page.getByRole("button", { name: "Apply proposed update", exact: true }).click();
  await page.getByRole("button", { name: "Accept case", exact: true }).first().click();
  await page.getByRole("button", { name: "Mark completed" }).click();
  await page.getByRole("button", { name: "Complete review", exact: true }).click();
  await page.getByRole("button", { name: "Reopen Testpaq" }).waitFor();
  await page.getByRole("button", { name: "Coverage approval", exact: false }).click();
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
  await page.getByRole("button", { name: "Initial ticket analysis", exact: true }).click();
  // Approval remains focused; case creation happens in the next stage.
  await page.getByRole("button", { name: /Coverage approval/ }).click();
  const proposalRow = page.locator(".scenario-row.review-proposed").first();
  const approvedId = await proposalRow.getAttribute("data-scenario-id");
  await proposalRow.getByRole("button", { name: "Accept scenario", exact: true }).click();
  await capture("accept-create");
  await page.getByRole("button", { name: "Continue to test cases", exact: true }).click();
  await page.getByLabel("Coverage output").selectOption(approvedId);
  await page.getByRole("button", { name: "Add test case", exact: true }).click();
  await page.getByLabel("Test case title").fill("Manual coverage from accepted suggestion");
  await page.getByLabel("Action", { exact: true }).fill("Carry out the selected behaviour");
  await page.getByRole("button", { name: "Accept case", exact: true }).click();
  assert.equal(await page.getByText("To be automated in Qase", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Initial ticket analysis", exact: true }).click();
  await page.getByRole("button", { name: /^Requirements & questions/ }).click();
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page
    .getByLabel(/^Requirement /)
    .last()
    .fill("New manual requirement needs coverage");
  await page.locator(".coverage-details summary").click();
  assert.equal(await page.getByRole("button", { name: "Suggest coverage for gaps", exact: true }).count(), 0);
  await page.getByRole("button", { name: /^Requirements & questions/ }).click();
  await page
    .getByLabel(/^Answer to:/)
    .first()
    .fill("Confirmed by Product: test both reader and owner views.");
  await page.getByRole("button", { name: "Save answer", exact: true }).first().click();
  // Answering a question changes scope but never prompts for analysis or navigates.
  assert.equal(await page.getByText("Questions answered", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: /^Test cases/ }).click();
  await page
    .getByText(/scope changed/)
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Coverage brief & handoff", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Download Qase CSV", exact: true }).isDisabled());
  await page.getByRole("button", { name: /^Test cases/ }).click();
  for (let index = 0; index < (await page.locator(".case-list-item").count()); index++) {
    await page.locator(".case-list-item").nth(index).click();
    if (await page.getByRole("button", { name: "Accept current scope", exact: true }).count())
      await page.getByRole("button", { name: "Accept current scope", exact: true }).click();
  }
  await page.getByRole("button", { name: "Initial ticket analysis", exact: true }).click();
  // UI remains usable in dark/mobile layouts.
  await page.getByRole("button", { name: "dark theme" }).click();
  await capture("dark-ticket");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Test cases/ }).click();
  assert.ok(await page.getByLabel("Test case title").first().isVisible());
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
          .map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right }))
          .slice(-15),
      ),
    ),
  );
  await page.getByRole("button", { name: "Coverage brief & handoff", exact: true }).click();
  assert.ok(await page.getByRole("button", { name: "Download Qase CSV" }).isVisible());
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
          .map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right }))
          .slice(-15),
      ),
    ),
  );
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
  await page.getByRole("button", { name: "Initial ticket analysis", exact: true }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  const generation = store.getSetting("workspace_generation");
  const restoreFile = join(directory, "restore.json");
  writeFileSync(restoreFile, JSON.stringify(store.backup()));
  const stale = await page.context().newPage();
  stale.on("pageerror", (error) => errors.push(error.message));
  await stale.goto(`${url}/#/testpaqs/${item.id}`);
  await stale.getByLabel("QA context").waitFor();
  await stale.route("**/api/testpaqs/*", (route) =>
    ["PUT", "PATCH"].includes(route.request().method()) ? route.abort("failed") : route.continue(),
  );
  await stale.getByLabel("QA context").fill("Unsaved stale-tab recovery text");
  await stale.getByText("Save failed", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Backup / restore", exact: true }).click();
  await page.getByLabel("Restore a Testpaq backup").setInputFiles(restoreFile);
  await page.getByRole("button", { name: "Replace workspace with selected backup", exact: true }).click();
  await page.getByRole("heading", { name: "Your workspace", exact: true }).waitFor();
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
  assert.equal(await page.getByLabel("Coverage output").inputValue(), "");
  await page.locator(".case-list-item").first().focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByLabel("Test case title").count(), 1);
  await page.getByRole("button", { name: "Next case", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByLabel("Test case title").inputValue(), "Hidden amount stays hidden after reload");
  // Returned drafts remain inspectable when the final available slot fills during drafting.
  const capacityItem = makeFixture();
  capacityItem.title = "Case capacity check";
  const seed = reviewedFixtureCase(capacityItem, capacityItem.scenarios[0]);
  capacityItem.testCases = Array.from({ length: 2999 }, (_, index) => ({ ...seed, id: crypto.randomUUID(), title: `Existing ${index}` }));
  store.save(capacityItem);
  await page.goto(`${url}/#/testpaqs/${capacityItem.id}`);
  await page.getByLabel("Description").waitFor();
  await page.getByRole("button", { name: "Analyse", exact: true }).click();
  const capacityDialog = page.getByRole("dialog");
  await capacityDialog.getByRole("button", { name: "Select none", exact: true }).click();
  await capacityDialog.getByRole("checkbox", { name: new RegExp(capacityItem.scenarios[0].title) }).check();
  await capacityDialog.getByRole("button", { name: "Analyse", exact: true }).click();
  await capacityDialog.waitFor({ state: "hidden" });
  await page.getByText(/Analysis partly finished/).waitFor();
  assert.equal(store.get(capacityItem.id).testCases.length, 3000);
  await page.getByRole("button", { name: "Analysis history", exact: true }).click();
  await page.getByText("Partial", { exact: true }).waitFor();
  await page.getByText("View returned drafts, including cases not saved", { exact: true }).click();
  await page.getByRole("heading", { name: "Anonymous reader sees no hidden campaign amount", exact: true }).waitFor();
  await page.getByRole("button", { name: "Analyse", exact: true }).click();
  assert.ok(
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: /^Test cases/ })
      .isDisabled(),
  );
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: host rejection, autosave, one Analyse dialog with chosen scope and no follow-up prompts, batched case drafting/update, lean multi-step Qase and Manual downloads, completion/inspection, model selection, backup, staged approval/create, Manual handoff, targeted revision comparison/application, question feedback without prompts, one focused editor, remembered views, archive/duplicate, cross-tab restore/draft recovery, keyboard and dark/mobile layouts, capacity notices and retained draft inspection.",
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
