import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { AnalysisInputSchema, AnalysisResultSchema, TestpaqSchema, type AnalysisResult, type Testpaq } from "../src/shared/domain.js";
import { renderMarkdown } from "../src/shared/export.js";
import { makeFixture } from "./fixture.js";
import { OpenAIAnalysisProvider, type AnalysisProvider } from "./provider.js";
import { BILLING_URL, providerError } from "./provider-errors.js";
import { applyAnalysis } from "../src/shared/analysis.js";
import type { ProviderStatus } from "../src/shared/domain.js";
import type { TestpaqStore } from "./store.js";

type AppOptions = {
  store: TestpaqStore;
  provider?: AnalysisProvider;
  sessionToken: string;
  allowedOrigin: string;
  distDir?: string;
  fixturesEnabled?: boolean;
};

export function createApp(options: AppOptions) {
  const app = new Hono();
  let provider = options.provider;
  let providerStatus: ProviderStatus = {
    status: provider ? "unchecked" : "unconfigured",
    message: provider
      ? "Key configured. API billing access has not been checked."
      : "Add OPENAI_API_KEY to .env and restart, or link a key for this session.",
    billingUrl: BILLING_URL,
  };
  let checking = false;
  const activeAnalyses = new Set<string>();
  app.use("/api/*", bodyLimit({ maxSize: 5 * 1024 * 1024, onError: (c) => c.json({ error: "Request exceeds the 5 MB limit." }, 413) }));
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: "no-referrer",
    }),
  );

  app.use("/api/*", async (context, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method)) {
      const origin = context.req.header("origin");
      const expectedOrigin = options.allowedOrigin === "self" ? new URL(context.req.url).origin : options.allowedOrigin;
      if (origin && origin !== expectedOrigin) return context.json({ error: "Origin not allowed." }, 403);
      if (context.req.header("x-testpaq-session") !== options.sessionToken) return context.json({ error: "Invalid local session." }, 403);
    }
    await next();
  });

  app.get("/api/config", (context) =>
    context.json({
      provider: provider?.name ?? "OpenAI",
      model: provider?.model ?? process.env.TESTPAQ_OPENAI_MODEL ?? "gpt-5-mini",
      configured: Boolean(provider),
      providerStatus,
      fixturesEnabled: Boolean(options.fixturesEnabled),
    }),
  );
  app.post("/api/provider/check", async (context) => {
    if (checking) return context.json({ error: "An API access check is already running." }, 409);
    const body = z
      .object({ apiKey: z.string().trim().min(1).max(500).optional(), model: z.string().trim().min(1).max(100).optional() })
      .parse(await context.req.json());
    if (body.apiKey) provider = new OpenAIAnalysisProvider(body.apiKey, body.model || process.env.TESTPAQ_OPENAI_MODEL);
    if (!provider) return context.json({ error: "Add or link an OpenAI API key first." }, 503);
    checking = true;
    try {
      if (!provider.checkAccess) throw new Error("This provider does not support an access check.");
      await provider.checkAccess();
      providerStatus = {
        status: "ready",
        message: "API access verified. A small billable request succeeded; exact remaining credit is available in OpenAI billing.",
        checkedAt: new Date().toISOString(),
        billingUrl: BILLING_URL,
      };
    } catch (error) {
      const detail = providerError(error);
      providerStatus = { status: "error", ...detail, message: detail.message, checkedAt: new Date().toISOString() };
    } finally {
      checking = false;
    }
    return context.json({
      provider: provider.name,
      model: provider.model,
      configured: true,
      fixturesEnabled: Boolean(options.fixturesEnabled),
      providerStatus,
    });
  });

  const GroupBody = z.object({ name: z.string().trim().min(1).max(100) });
  app.get("/api/groups", (context) => context.json(options.store.listGroups()));
  app.post("/api/groups", async (context) => {
    const { name } = GroupBody.parse(await context.req.json());
    if (options.store.listGroups().some((group) => group.name.toLowerCase() === name.toLowerCase()))
      return context.json({ error: "A group with this name already exists." }, 409);
    return context.json(options.store.saveGroup(name), 201);
  });
  app.put("/api/groups/:id", async (context) => {
    const id = context.req.param("id");
    const { name } = GroupBody.parse(await context.req.json());
    if (!options.store.listGroups().some((group) => group.id === id)) return context.json({ error: "Group not found." }, 404);
    if (options.store.listGroups().some((group) => group.id !== id && group.name.toLowerCase() === name.toLowerCase()))
      return context.json({ error: "A group with this name already exists." }, 409);
    return context.json(options.store.saveGroup(name, id));
  });
  app.delete("/api/groups/:id", (context) =>
    options.store.removeGroup(context.req.param("id")) ? context.body(null, 204) : context.json({ error: "Group not found." }, 404),
  );

  app.get("/api/testpaqs", (context) => context.json(options.store.list()));
  app.post("/api/testpaqs", async (context) => {
    const body = z.object({ title: z.string().trim().min(1).max(300), groupId: z.uuid().optional() }).parse(await context.req.json());
    if (body.groupId && !options.store.listGroups().some((group) => group.id === body.groupId))
      return context.json({ error: "Group not found." }, 400);
    const timestamp = new Date().toISOString();
    const item: Testpaq = {
      id: randomUUID(),
      title: body.title,
      groupId: body.groupId,
      status: "draft",
      ticket: { reference: "", title: body.title, description: "", acceptanceCriteria: "", qaContext: "" },
      requirements: [],
      scenarios: [],
      questions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return context.json(options.store.save(item), 201);
  });
  app.get("/api/testpaqs/:id", (context) => {
    const item = options.store.get(context.req.param("id"));
    return item ? context.json(item) : context.json({ error: "Testpaq not found." }, 404);
  });
  app.put("/api/testpaqs/:id", async (context) => {
    const body = TestpaqSchema.parse(await context.req.json());
    if (body.id !== context.req.param("id")) return context.json({ error: "ID mismatch." }, 400);
    const existing = options.store.get(body.id);
    if (!existing) return context.json({ error: "Testpaq not found." }, 404);
    if (body.updatedAt !== existing.updatedAt)
      return context.json(
        { error: "This Testpaq changed in another tab. Reload before saving to avoid overwriting changes.", code: "save_conflict" },
        409,
      );
    if (body.groupId && !options.store.listGroups().some((group) => group.id === body.groupId))
      return context.json({ error: "Group not found." }, 400);
    return context.json(
      options.store.save({
        ...body,
        createdAt: existing.createdAt,
        updatedAt: new Date(Math.max(Date.now(), Date.parse(existing.updatedAt) + 1)).toISOString(),
      }),
    );
  });
  app.delete("/api/testpaqs/:id", (context) =>
    options.store.remove(context.req.param("id")) ? context.body(null, 204) : context.json({ error: "Testpaq not found." }, 404),
  );
  app.get("/api/testpaqs/:id/history", (context) => context.json(options.store.getRuns(context.req.param("id"))));
  app.get("/api/testpaqs/:id/export", (context) => {
    const item = options.store.get(context.req.param("id"));
    if (!item) return context.json({ error: "Testpaq not found." }, 404);
    const fileName = `${slug(item.ticket.reference || item.title)}-qa-coverage.md`;
    context.header("content-type", "text/markdown; charset=utf-8");
    context.header("content-disposition", `attachment; filename="${fileName}"`);
    return context.body(renderMarkdown(item, context.req.query("rejected") === "1"));
  });
  app.post("/api/analyse", async (context) => {
    const input = AnalysisInputSchema.parse(await context.req.json());
    const original = options.store.get(input.testpaqId);
    if (!original) return context.json({ error: "Testpaq not found." }, 404);
    if (activeAnalyses.has(input.testpaqId)) return context.json({ error: "Analysis is already running for this Testpaq." }, 409);
    if (
      JSON.stringify(input.ticket) !== JSON.stringify(original.ticket) ||
      JSON.stringify(input.requirements) !== JSON.stringify(original.requirements) ||
      (input.questions && JSON.stringify(input.questions) !== JSON.stringify(original.questions)) ||
      (input.scenarios && JSON.stringify(input.scenarios) !== JSON.stringify(original.scenarios))
    )
      return context.json(
        { error: "Save the latest changes before analysing. The Testpaq has changed; reload and retry.", code: "analysis_conflict" },
        409,
      );
    const currentProvider = provider;
    const providerName = currentProvider?.name ?? "OpenAI";
    const model = currentProvider?.model ?? process.env.TESTPAQ_OPENAI_MODEL ?? "gpt-5-mini";
    const disclosure = `Ticket title, description, acceptance criteria, QA context and ${input.requirements.length} current requirements, ${input.questions?.length ?? 0} questions/answers and ${input.scenarios?.length ?? 0} existing scenarios`;
    const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const run = options.store.startRun({
      testpaqId: input.testpaqId,
      provider: providerName,
      model,
      promptVersion: "testpaq-analysis-v2",
      disclosure,
      inputHash,
      inputSnapshot: input,
    });
    if (!currentProvider) {
      options.store.failRun(run.id, "provider_not_configured");
      return context.json({ error: "OpenAI is not configured. Set OPENAI_API_KEY on the server and retry.", runId: run.id }, 503);
    }
    activeAnalyses.add(input.testpaqId);
    try {
      const result = await currentProvider.analyse(input, context.req.raw.signal);
      if (context.req.raw.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const latest = options.store.get(input.testpaqId);
      if (!latest || latest.updatedAt !== original.updatedAt) {
        options.store.failRun(run.id, "analysis_conflict");
        return context.json(
          { error: "The Testpaq changed during analysis. Nothing was applied; reload and refresh again.", code: "analysis_conflict" },
          409,
        );
      }
      const completed = options.store.database.transaction(() => {
        // Validate the result and merged aggregate before committing either record.
        const validated = normalizeResult(AnalysisResultSchema.parse(result));
        const item = applyAnalysis(latest, validated);
        const runRecord = options.store.finishRun(run.id, validated);
        options.store.save(item);
        return { run: runRecord, result: runRecord.result, item };
      })();
      if (provider === currentProvider)
        providerStatus = {
          status: "ready",
          message: "API access verified by a successful analysis. See OpenAI billing for your remaining credit.",
          checkedAt: new Date().toISOString(),
          billingUrl: BILLING_URL,
        };
      return context.json(completed);
    } catch (error) {
      if (context.req.raw.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        options.store.failRun(run.id, "cancelled");
        return context.json({ error: "Analysis cancelled.", runId: run.id }, 409);
      }
      const detail = providerError(error);
      options.store.failRun(run.id, detail.code);
      if (provider === currentProvider && detail.code !== "invalid_analysis") providerStatus = { status: "error", ...detail };
      return context.json({ error: detail.message, code: detail.code, billingUrl: detail.billingUrl, runId: run.id }, 502);
    } finally {
      activeAnalyses.delete(input.testpaqId);
    }
  });

  if (options.fixturesEnabled) {
    app.post("/api/dev/fixtures/:kind", (context) => {
      const item = makeFixture(context.req.param("kind") === "stress");
      return context.json(options.store.save(item), 201);
    });
  }

  if (options.distDir) {
    const indexPath = join(options.distDir, "index.html");
    app.get("*", (context) => {
      const path = context.req.path === "/" ? "index.html" : context.req.path.slice(1);
      if (path === "index.html") {
        const html = readFileSync(indexPath, "utf8").replace("__TESTPAQ_SESSION__", options.sessionToken);
        return context.html(html);
      }
      try {
        const assetPath = resolve(options.distDir!, path);
        if (!assetPath.startsWith(`${resolve(options.distDir!)}${process.platform === "win32" ? "\\" : "/"}`))
          throw new Error("Invalid asset path");
        const content = readFileSync(assetPath);
        context.header("content-type", mime(path));
        return context.body(content);
      } catch {
        const html = readFileSync(indexPath, "utf8").replace("__TESTPAQ_SESSION__", options.sessionToken);
        return context.html(html);
      }
    });
  }

  app.onError((error, context) => {
    if (error instanceof z.ZodError)
      return context.json(
        { error: "Request validation failed.", issues: error.issues.map(({ path, message }) => ({ path, message })) },
        400,
      );
    if (error instanceof SyntaxError) return context.json({ error: "Malformed JSON request." }, 400);
    console.error("Testpaq request failed", { name: error.name });
    return context.json({ error: "Unexpected local service error." }, 500);
  });
  return app;
}

function normalizeResult(result: AnalysisResult): AnalysisResult {
  return {
    requirements: result.requirements,
    scenarios: result.scenarios.map((scenario) => ({ ...scenario, rationale: scenario.rationale || undefined })),
    questions: result.questions.map((question) => ({
      ...question,
      requirementClientId: question.requirementClientId || undefined,
      scenarioClientId: question.scenarioClientId || undefined,
    })),
  };
}
function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "testpaq"
  );
}
function mime(path: string) {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return path.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
}
