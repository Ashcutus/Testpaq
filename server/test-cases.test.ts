// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { TestpaqStore } from "./store";
import { makeFixture } from "./fixture";
import { newTestCase } from "../src/shared/test-cases";
import type { AnalysisProvider } from "./provider";
const result = {
  testCases: [
    {
      clientId: "reload",
      title: "Hide persists after reload",
      objective: "Verify saved visibility",
      preconditions: "Owner is signed in",
      postconditions: "Restore visibility",
      steps: [
        { action: "Hide amount", data: "", expectedResult: "Amount is hidden" },
        { action: "Reload", data: "", expectedResult: "Amount stays hidden" },
      ],
      unknowns: [],
    },
  ],
};
function setup(generateCases: NonNullable<AnalysisProvider["generateCases"]>) {
  const store = new TestpaqStore(":memory:");
  const item = makeFixture();
  item.testCases = [{ ...newTestCase(item, item.scenarios[0]), review: "accepted" }];
  store.save(item);
  const provider: AnalysisProvider = {
    name: "Fixture",
    model: "fixture-model",
    analyse: async () => ({ requirements: [], scenarios: [], questions: [] }),
    generateCases,
  };
  const app = createApp({ store, provider, sessionToken: "secret", allowedOrigin: "http://localhost" });
  const send = (body: unknown) =>
    app.request("/api/test-cases/draft", {
      method: "POST",
      headers: { "x-testpaq-session": "secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const request = { testpaqId: item.id, scenarioId: item.scenarios[0].id, updatedAt: item.updatedAt, model: provider.model };
  return { store, item, app, send, request };
}
describe("case drafting API", () => {
  it("records the exact selected context and atomically adds proposals without altering accepted cases", async () => {
    const generate = vi.fn<NonNullable<AnalysisProvider["generateCases"]>>(async () => result);
    const { store, item, send, request } = setup(generate);
    try {
      const response = await send(request);
      expect(response.status).toBe(200);
      const saved = store.get(item.id)!;
      expect(saved.testCases).toHaveLength(2);
      expect(saved.testCases![0]).toEqual(item.testCases![0]);
      expect(saved.testCases![1]).toMatchObject({ review: "proposed", scenarioId: request.scenarioId, origin: "generated" });
      const input = generate.mock.calls[0][0];
      expect(input.scenarios).toHaveLength(1);
      expect(input.testCases).toEqual(item.testCases);
      expect(input.requirements.every((value) => item.scenarios[0].requirementIds.includes(value.id))).toBe(true);
      const run = store.getRuns(item.id)[0];
      expect(run).toMatchObject({ status: "succeeded", promptVersion: "testpaq-test-cases-v1", result });
      expect(run.inputSnapshot).toMatchObject({ scenarioId: request.scenarioId, testCases: item.testCases });
      const backup = store.backup();
      expect(backup.runs[0].result).toEqual(result);
      const restored = new TestpaqStore(":memory:");
      try {
        restored.restore(backup);
        expect(restored.get(item.id)?.testCases).toEqual(saved.testCases);
        expect(restored.getRuns(item.id)[0].result).toEqual(result);
      } finally {
        restored.close();
      }
    } finally {
      store.close();
    }
  });
  it("rejects stale, completed and unaccepted coverage before sending content", async () => {
    const generate = vi.fn<NonNullable<AnalysisProvider["generateCases"]>>(async () => result);
    const { store, item, send, request } = setup(generate);
    try {
      expect((await send({ ...request, model: "wrong-model" })).status).toBe(409);
      expect((await send({ ...request, updatedAt: "2020-01-01T00:00:00.000Z" })).status).toBe(409);
      item.scenarios[0].review = "proposed";
      store.save(item);
      expect((await send(request)).status).toBe(400);
      item.status = "completed";
      store.save(item);
      expect((await send(request)).status).toBe(409);
      expect(generate).not.toHaveBeenCalled();
      expect(store.getRuns(item.id)).toEqual([]);
    } finally {
      store.close();
    }
  });
  it("rolls back invalid output and concurrent scope changes while retaining failed run history", async () => {
    const first = setup(async () => ({ testCases: [{ ...result.testCases[0], steps: [] }] }));
    try {
      expect((await first.send(first.request)).status).toBe(502);
      expect(first.store.get(first.item.id)).toEqual(first.item);
      expect(first.store.getRuns(first.item.id)[0]).toMatchObject({ status: "failed", errorCode: "invalid_analysis" });
    } finally {
      first.store.close();
    }
    let release!: (value: typeof result) => void;
    const second = setup(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    try {
      const pending = second.send(second.request);
      while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
      expect((await second.send(second.request)).status).toBe(409);
      second.store.save({
        ...second.item,
        ticket: { ...second.item.ticket, description: "Changed scope" },
        updatedAt: new Date(Date.parse(second.item.updatedAt) + 1).toISOString(),
      });
      release(result);
      expect((await pending).status).toBe(409);
      expect(second.store.get(second.item.id)?.testCases).toHaveLength(1);
      expect(second.store.getRuns(second.item.id)[0]).toMatchObject({ status: "failed", errorCode: "analysis_conflict" });
    } finally {
      second.store.close();
    }
  });
});
