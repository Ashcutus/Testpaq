import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { AnalysisInputSchema, TestpaqSchema, type AnalysisResult, type Testpaq } from "../src/shared/domain.js";
import { renderMarkdown } from "../src/shared/export.js";
import { makeFixture } from "./fixture.js";
import type { AnalysisProvider } from "./provider.js";
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
      provider: options.provider?.name ?? "OpenAI",
      model: options.provider?.model ?? process.env.TESTPAQ_OPENAI_MODEL ?? "gpt-5-mini",
      configured: Boolean(options.provider),
      fixturesEnabled: Boolean(options.fixturesEnabled),
    }),
  );
  app.get("/api/testpaqs", (context) => context.json(options.store.list()));
  app.post("/api/testpaqs", async (context) => {
    const body = z.object({ title: z.string().trim().min(1).max(300) }).parse(await context.req.json());
    const timestamp = new Date().toISOString();
    const item: Testpaq = {
      id: randomUUID(),
      title: body.title,
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
    return context.json(options.store.save({ ...body, updatedAt: new Date().toISOString() }));
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
    if (!options.store.get(input.testpaqId)) return context.json({ error: "Testpaq not found." }, 404);
    const providerName = options.provider?.name ?? "OpenAI";
    const model = options.provider?.model ?? process.env.TESTPAQ_OPENAI_MODEL ?? "gpt-5-mini";
    const disclosure = `Ticket title, description, acceptance criteria, QA context and ${input.requirements.length} current requirements`;
    const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const run = options.store.startRun({
      testpaqId: input.testpaqId,
      provider: providerName,
      model,
      promptVersion: "testpaq-analysis-v1",
      disclosure,
      inputHash,
    });
    if (!options.provider) {
      options.store.failRun(run.id, "provider_not_configured");
      return context.json({ error: "OpenAI is not configured. Set OPENAI_API_KEY on the server and retry.", runId: run.id }, 503);
    }
    try {
      const result = await options.provider.analyse(input);
      const completed = options.store.finishRun(run.id, normalizeResult(result));
      return context.json({ run: completed, result: completed.result });
    } catch (error) {
      const errorCode =
        error instanceof z.ZodError || (error instanceof Error && error.name === "ZodError") ? "invalid_analysis" : "provider_error";
      options.store.failRun(run.id, errorCode);
      return context.json(
        {
          error:
            errorCode === "invalid_analysis"
              ? "The provider response failed Testpaq's safety validation. Nothing was added."
              : "Analysis failed. Nothing was added; review the server configuration and retry.",
          runId: run.id,
        },
        502,
      );
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
    console.error("Testpaq request failed", { name: error.name, message: error.message });
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
