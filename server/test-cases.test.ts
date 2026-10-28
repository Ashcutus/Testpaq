// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { TestpaqStore } from "./store";
import { makeFixture, reviewedFixtureCase } from "./fixture";
import type { AnalysisProvider } from "./provider";
import type { CaseBatchInput } from "../src/shared/domain";

type Draft = NonNullable<AnalysisProvider["draftCases"]>;
const generated = (scenarioId: string, clientId = "reload", replacesCaseId: string | null = null) => ({
  clientId,
  scenarioId,
  replacesCaseId: replacesCaseId ?? undefined,
  title: `Hide persists after reload (${clientId})`,
  description: "Verify saved visibility",
  preconditions: "Owner is signed in",
  steps: [
    { action: "Hide amount", data: "", expectedResult: "Amount is hidden" },
    { action: "Reload", data: "", expectedResult: "Amount stays hidden" },
  ],
});
function setup(draftCases: Draft) {
  const store = new TestpaqStore(":memory:");
  const item = makeFixture();
  item.testCases = [{ ...reviewedFixtureCase(item, item.scenarios[0]), review: "accepted" }];
  store.save(item);
  const provider: AnalysisProvider = {
    name: "Fixture",
    model: "fixture-model",
    analyse: async () => ({ requirements: [], scenarios: [], questions: [] }),
    draftCases,
  };
  const app = createApp({ store, provider, sessionToken: "secret", allowedOrigin: "http://localhost" });
  const send = (body: unknown) =>
    app.request("/api/test-cases/draft", {
      method: "POST",
      headers: { "x-testpaq-session": "secret", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const request = { testpaqId: item.id, scenarioIds: [item.scenarios[0].id], updatedAt: item.updatedAt, model: provider.model };
  return { store, item, app, send, request };
}
describe("case drafting API", () => {
  it("drafts for several coverage outputs in one request and records one run without altering accepted cases", async () => {
    const draft = vi.fn<Draft>(async (input) => ({ testCases: input.scenarios.map((value) => generated(value.id, value.id.slice(0, 4))) }));
    const { store, item, send, request } = setup(draft);
    try {
      const response = await send({ ...request, scenarioIds: [item.scenarios[0].id, item.scenarios[1].id] });
      expect(response.status).toBe(200);
      expect(draft).toHaveBeenCalledTimes(1);
      const saved = store.get(item.id)!;
      expect(saved.testCases).toHaveLength(3);
      expect(saved.testCases![0]).toEqual(item.testCases![0]);
      expect(saved.testCases!.slice(1)).toMatchObject([
        { review: "proposed", scenarioId: item.scenarios[0].id, origin: "generated", postconditions: "", unknowns: [] },
        { review: "proposed", scenarioId: item.scenarios[1].id, origin: "generated" },
      ]);
      const input = draft.mock.calls[0][0];
      expect(input.scenarios.map((value) => value.id)).toEqual([item.scenarios[0].id, item.scenarios[1].id]);
      expect(input.testCases).toEqual(item.testCases);
      expect(store.getRuns(item.id)).toHaveLength(1);
      const run = store.getRuns(item.id)[0];
      expect(run).toMatchObject({ status: "succeeded", promptVersion: "testpaq-test-cases-v5" });
      expect(run.inputSnapshot).toMatchObject({ testCases: item.testCases, updateCaseIds: [] });
      const backup = store.backup();
      const restored = new TestpaqStore(":memory:");
      try {
        restored.restore(backup);
        expect(restored.get(item.id)?.testCases).toEqual(saved.testCases);
        expect(restored.getRuns(item.id)[0].result).toEqual(run.result);
      } finally {
        restored.close();
      }
    } finally {
      store.close();
    }
  });
  it("splits a large selection into sequential provider calls but one run", async () => {
    const draft = vi.fn<Draft>(async (input) => ({ testCases: [generated(input.scenarios[0].id, "same")] }));
    const { store, item, send, request } = setup(draft);
    try {
      const ids = item.scenarios.slice(0, 13).map((value) => value.id);
      expect((await send({ ...request, scenarioIds: ids })).status).toBe(200);
      expect(draft).toHaveBeenCalledTimes(3);
      expect(draft.mock.calls.map((call) => call[0].scenarios.length)).toEqual([6, 6, 1]);
      expect(store.getRuns(item.id)).toHaveLength(1);
      expect(store.get(item.id)!.testCases).toHaveLength(1 + 3);
    } finally {
      store.close();
    }
  });
  it("rejects stale, completed and unaccepted coverage before sending content", async () => {
    const draft = vi.fn<Draft>(async (input) => ({ testCases: [generated(input.scenarios[0].id)] }));
    const { store, item, send, request } = setup(draft);
    try {
      expect((await send({ ...request, model: "wrong-model" })).status).toBe(409);
      expect((await send({ ...request, updatedAt: "2020-01-01T00:00:00.000Z" })).status).toBe(409);
      item.scenarios[0].review = "proposed";
      store.save(item);
      expect((await send(request)).status).toBe(400);
      item.status = "completed";
      store.save(item);
      expect((await send(request)).status).toBe(409);
      expect(draft).not.toHaveBeenCalled();
      expect(store.getRuns(item.id)).toEqual([]);
    } finally {
      store.close();
    }
  });
  it("rolls back invalid output and concurrent scope changes while retaining failed run history", async () => {
    const first = setup(async (input) => ({ testCases: [{ ...generated(input.scenarios[0].id), steps: [] }] }));
    try {
      expect((await first.send(first.request)).status).toBe(502);
      expect(first.store.get(first.item.id)).toEqual(first.item);
      expect(first.store.getRuns(first.item.id)[0]).toMatchObject({ status: "failed", errorCode: "invalid_analysis" });
    } finally {
      first.store.close();
    }
    let release!: (value: Awaited<ReturnType<Draft>>) => void;
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
      release({ testCases: [generated(second.item.scenarios[0].id)] });
      expect((await pending).status).toBe(409);
      expect(second.store.get(second.item.id)?.testCases).toHaveLength(1);
      expect(second.store.getRuns(second.item.id)[0]).toMatchObject({ status: "failed", errorCode: "analysis_conflict" });
    } finally {
      second.store.close();
    }
  });
});

describe("batched case updates", () => {
  it("proposes an update beside the accepted case, and ignores revisions that were not requested", async () => {
    const draft = vi.fn<Draft>(async (input: CaseBatchInput) => ({
      testCases: [
        generated(input.scenarios[0].id, "update", input.testCases[0].id),
        generated(input.scenarios[0].id, "other", crypto.randomUUID()),
      ],
    }));
    const { store, item, send, request } = setup(draft);
    try {
      const target = item.testCases![0];
      expect((await send({ ...request, updateCaseIds: [crypto.randomUUID()] })).status).toBe(400);
      expect(draft).not.toHaveBeenCalled();
      expect((await send({ ...request, updateCaseIds: [target.id] })).status).toBe(200);
      const saved = store.get(item.id)!;
      expect(saved.testCases![0]).toEqual(target);
      expect(saved.testCases).toHaveLength(2);
      expect(saved.testCases![1]).toMatchObject({ replacesCaseId: target.id, review: "proposed", destinations: target.destinations });
      expect(draft.mock.calls[0][0].updateCaseIds).toEqual([target.id]);
      expect(store.backup().testpaqs[0].testCases![1].replacesCaseId).toBe(target.id);
    } finally {
      store.close();
    }
  });
  it("rejects several revisions for one case without mutating the original", async () => {
    const { store, item, send, request } = setup(async (input) => ({
      testCases: [
        generated(input.scenarios[0].id, "a", input.testCases[0].id),
        generated(input.scenarios[0].id, "b", input.testCases[0].id),
      ],
    }));
    try {
      expect((await send({ ...request, updateCaseIds: [item.testCases![0].id] })).status).toBe(502);
      expect(store.get(item.id)).toEqual(item);
      expect(store.getRuns(item.id)[0].status).toBe("failed");
    } finally {
      store.close();
    }
  });
});

describe("batch boundaries", () => {
  it("ignores misrouted revision targets across chunks without breaking run completion", async () => {
    let firstTarget = "";
    const { store, item, send, request } = setup(async (input) => ({
      testCases: [generated(input.scenarios[0].id, "update", firstTarget)],
    }));
    try {
      firstTarget = item.testCases![0].id;
      const later = reviewedFixtureCase(item, item.scenarios[6]);
      item.testCases!.push(later);
      store.save(item);
      const response = await send({
        ...request,
        scenarioIds: item.scenarios.slice(0, 7).map((value) => value.id),
        updateCaseIds: [firstTarget, later.id],
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ revised: 1, missingUpdateCaseIds: [later.id] });
      expect(store.getRuns(item.id)[0].status).toBe("succeeded");
    } finally {
      store.close();
    }
  });
  it("retains all legal chunk results beyond the former 6000 aggregate limit", async () => {
    const { store, item, send, request } = setup(async (input) => ({
      testCases: input.scenarios.flatMap((scenario) =>
        Array.from({ length: 31 }, (_, index) => generated(scenario.id, `${scenario.id}-${index}`)),
      ),
    }));
    try {
      const stress = makeFixture(true);
      item.scenarios = stress.scenarios.map((scenario) => ({ ...scenario, requirementIds: [item.requirements[0].id], review: "accepted" }));
      // Keep the initial original case under one valid parent in the stress selection.
      item.testCases = [];
      item.questions = [];
      store.save(item);
      const response = await send({ ...request, scenarioIds: item.scenarios.map((value) => value.id) });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ added: 3000, capacitySkippedNewCases: 3200 });
      const result = store.getRuns(item.id)[0].result!;
      expect("testCases" in result && result.testCases.length).toBe(6200);
    } finally {
      store.close();
    }
    // Applying 3,000 cases revalidates the aggregate repeatedly, so this extreme case needs more than the 5 s default.
  }, 30_000);
  it("retains earlier returned drafts when a later chunk fails, without applying them", async () => {
    let calls = 0;
    const { store, item, send, request } = setup(async (input) => {
      if (++calls === 2) throw new Error("Synthetic failure");
      return { testCases: [generated(input.scenarios[0].id)] };
    });
    try {
      expect((await send({ ...request, scenarioIds: item.scenarios.slice(0, 7).map((value) => value.id) })).status).toBe(502);
      expect(store.get(item.id)!.testCases).toEqual(item.testCases);
      const run = store.getRuns(item.id)[0];
      expect(run).toMatchObject({ status: "failed", result: { incomplete: { completedChunks: 1, totalChunks: 2 } } });
      expect(run.result && "testCases" in run.result && run.result.testCases).toHaveLength(1);
      const restored = new TestpaqStore(":memory:");
      try {
        restored.restore(store.backup());
        expect(restored.getRuns(item.id)[0].result).toEqual(run.result);
      } finally {
        restored.close();
      }
    } finally {
      store.close();
    }
  });
  it("keeps the large-ticket 72-case reproduction small enough for ordinary saves", async () => {
    const { store, item, send, request, app } = setup(async (input) => ({
      testCases: input.scenarios.flatMap((scenario, n) => Array.from({ length: 12 }, (_, i) => generated(scenario.id, `${n}-${i}`))),
    }));
    try {
      item.testCases = [];
      item.ticket.description = "x".repeat(30000);
      item.ticket.acceptanceCriteria = "y".repeat(30000);
      item.ticket.qaContext = "z".repeat(20000);
      store.save(item);
      expect((await send({ ...request, scenarioIds: item.scenarios.slice(0, 6).map((value) => value.id) })).status).toBe(200);
      const saved = store.get(item.id)!;
      expect(saved.testCases).toHaveLength(72);
      const body = JSON.stringify({ ...saved, title: "Still editable" });
      expect(Buffer.byteLength(body)).toBeLessThan(250000);
      expect(
        (
          await app.request(`/api/testpaqs/${item.id}`, {
            method: "PUT",
            headers: { "x-testpaq-session": "secret", "content-type": "application/json" },
            body,
          })
        ).status,
      ).toBe(200);
    } finally {
      store.close();
    }
  });
  it("preserves valid maximum-length provider IDs and namespaces repeated IDs across chunks", async () => {
    const { store, item, send, request } = setup(async (input) => ({
      testCases: [generated(input.scenarios[0].id, "x".repeat(100))],
    }));
    try {
      const response = await send({ ...request, scenarioIds: item.scenarios.slice(0, 7).map((value) => value.id) });
      expect(response.status).toBe(200);
      expect(store.get(item.id)!.testCases).toHaveLength(3);
      const result = store.getRuns(item.id)[0].result!;
      expect("testCases" in result && result.testCases.map((value) => value.clientId)).toEqual(["0:0", "1:0"]);
    } finally {
      store.close();
    }
  });
  it("still rejects duplicate provider IDs within a chunk before remapping them", async () => {
    const { store, item, send, request } = setup(async (input) => ({
      testCases: [generated(input.scenarios[0].id, "same"), generated(input.scenarios[1].id, "same")],
    }));
    try {
      expect((await send({ ...request, scenarioIds: item.scenarios.slice(0, 2).map((value) => value.id) })).status).toBe(502);
      expect(store.get(item.id)!.testCases).toHaveLength(1);
    } finally {
      store.close();
    }
  });
  it("blocks a full Testpaq before starting a run or invoking the provider", async () => {
    const draft = vi.fn<Draft>(async () => ({ testCases: [] }));
    const { store, item, send, request } = setup(draft);
    try {
      item.testCases = Array.from({ length: 3000 }, (_, index) => ({
        ...item.testCases![0],
        id: crypto.randomUUID(),
        title: `Existing ${index}`,
      }));
      store.save(item);
      const response = await send(request);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "case_capacity" });
      expect(draft).not.toHaveBeenCalled();
      expect(store.getRuns(item.id)).toEqual([]);
    } finally {
      store.close();
    }
  });
  it("prioritizes updates across coverage and preserves explicit capacity outcomes through backup and restore", async () => {
    const { store, item, request } = setup(async () => ({ testCases: [] }));
    const later = item.scenarios[1];
    const first = reviewedFixtureCase(item, later),
      second = reviewedFixtureCase(item, later);
    item.testCases = [
      first,
      second,
      ...Array.from({ length: 2997 }, (_, index) => ({ ...item.testCases![0], id: crypto.randomUUID(), title: `Existing ${index}` })),
    ];
    store.save(item);
    // A fresh app shares this store and returns additions for the first coverage before revisions for later coverage.
    const provider: AnalysisProvider = {
      name: "Fixture",
      model: "fixture-model",
      analyse: async () => ({ requirements: [], scenarios: [], questions: [] }),
      draftCases: async () => ({
        testCases: [
          generated(item.scenarios[0].id, "new"),
          generated(later.id, "first", first.id),
          generated(later.id, "second", second.id),
        ],
      }),
    };
    const app = createApp({ store, provider, sessionToken: "secret", allowedOrigin: "http://localhost" });
    const response = await app.request("/api/test-cases/draft", {
      method: "POST",
      headers: { "x-testpaq-session": "secret", "content-type": "application/json" },
      body: JSON.stringify({ ...request, scenarioIds: [item.scenarios[0].id, later.id], updateCaseIds: [first.id, second.id] }),
    });
    try {
      expect(response.status).toBe(200);
      const body = await response.json();
      const application = {
        added: 0,
        revised: 1,
        missingUpdateCaseIds: [],
        capacitySkippedNewCases: 1,
        capacitySkippedUpdateCaseIds: [second.id],
      };
      expect(body).toMatchObject(application);
      expect(store.get(item.id)!.testCases).toHaveLength(3000);
      const run = store.getRuns(item.id)[0];
      expect(run.result).toMatchObject({ application, testCases: expect.any(Array) });
      const restored = new TestpaqStore(":memory:");
      try {
        restored.restore(store.backup());
        expect(restored.getRuns(item.id)[0].result).toEqual(run.result);
      } finally {
        restored.close();
      }
    } finally {
      store.close();
    }
  });
  it("saves merged chunks and many cases per coverage instead of discarding a valid response", async () => {
    const draft = vi.fn<Draft>(async (input) => ({
      testCases: input.scenarios.flatMap((value) =>
        Array.from({ length: 40 }, (_, index) => ({
          ...generated(value.id, `${value.id.slice(0, 6)}-${index}`),
          title: `Case ${value.id.slice(0, 6)} ${index}`,
          steps: [{ action: `Act ${value.id.slice(0, 6)} ${index}`, data: "", expectedResult: "Result" }],
        })),
      ),
    }));
    const { store, item, send, request } = setup(draft);
    try {
      const ids = item.scenarios.slice(0, 13).map((value) => value.id);
      const response = await send({ ...request, scenarioIds: ids });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { added: number; missingUpdateCaseIds: string[] };
      // 13 coverage outputs x 40 returned cases exceeds both the old 300-case and 30-per-coverage limits.
      expect(body.added).toBe(520);
      expect(store.get(item.id)!.testCases).toHaveLength(521);
      expect(store.getRuns(item.id)).toHaveLength(1);
      expect(store.getRuns(item.id)[0].status).toBe("succeeded");
    } finally {
      store.close();
    }
  });
  it("reports a requested update that came back empty and keeps the run honest", async () => {
    const { store, item, send, request } = setup(async () => ({ testCases: [] }));
    try {
      const target = item.testCases![0];
      const response = await send({ ...request, updateCaseIds: [target.id] });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { revised: number; missingUpdateCaseIds: string[] };
      expect(body).toMatchObject({ revised: 0, missingUpdateCaseIds: [target.id] });
      expect(store.get(item.id)!.testCases).toEqual(item.testCases);
    } finally {
      store.close();
    }
  });
});
