// @vitest-environment node
import { expect, it } from "vitest";
import { createApp } from "./app";
import { TestpaqStore } from "./store";
import { makeFixture, reviewedFixtureCase } from "./fixture";
import { caseScopeSignature } from "../src/shared/test-cases";

function setup() {
  const store = new TestpaqStore(":memory:");
  const item = makeFixture();
  item.testCases = [reviewedFixtureCase(item)];
  store.save(item);
  const app = createApp({ store, sessionToken: "test", allowedOrigin: "http://localhost" });
  const request = (path: string, method: string, body?: unknown, generation?: string) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-testpaq-session": "test",
        ...(generation ? { "x-testpaq-workspace": generation } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { store, item, app, request };
}
it("rejects every stale workspace mutation after restore and invalidates unscoped save versions", async () => {
  const { store, item, app, request } = setup();
  try {
    const old = (await app.request("/api/config")).headers.get("x-testpaq-workspace")!;
    const backup = store.backup();
    const restored = await request("/api/workspace/restore", "POST", backup, old);
    expect(restored.status).toBe(200);
    expect(restored.headers.get("x-testpaq-workspace")).not.toBe(old);
    expect((await request(`/api/testpaqs/${item.id}`, "PUT", item, old)).status).toBe(409);
    expect((await request(`/api/testpaqs/${item.id}`, "DELETE", undefined, old)).status).toBe(409);
    expect((await request("/api/groups", "POST", { name: "Stale group" }, old)).status).toBe(409);
    expect((await request(`/api/testpaqs/${item.id}`, "PUT", item)).status).toBe(409);
    expect(store.get(item.id)?.ticket).toEqual(item.ticket);
    expect(store.listGroups()).toEqual([]);
  } finally {
    store.close();
  }
});
it("leaves generation and content unchanged when restore validation fails", async () => {
  const { store, item, app, request } = setup();
  try {
    const old = (await app.request("/api/config")).headers.get("x-testpaq-workspace")!;
    expect((await request("/api/workspace/restore", "POST", { format: "bad" }, old)).status).toBe(400);
    expect((await app.request("/api/config")).headers.get("x-testpaq-workspace")).toBe(old);
    expect(store.get(item.id)).toEqual(item);
  } finally {
    store.close();
  }
});
it("archives reversibly, preserves history, and duplicates with new IDs and renewed review", async () => {
  const { store, item, app, request } = setup();
  try {
    const run = store.startRun({
      testpaqId: item.id,
      provider: "fixture",
      model: "fixture",
      promptVersion: "v2",
      disclosure: "fixture",
      inputHash: "fixture",
    });
    store.finishRun(run.id, { requirements: [], scenarios: [], questions: [] });
    const archived = await request(`/api/testpaqs/${item.id}/archive`, "PATCH", { archived: true, updatedAt: item.updatedAt });
    expect(archived.status).toBe(200);
    expect(await (await app.request("/api/testpaqs")).json()).toEqual([]);
    expect((await (await app.request("/api/testpaqs?archive=archived")).json()).length).toBe(1);
    expect((await request(`/api/testpaqs/${item.id}`, "PUT", store.get(item.id))).status).toBe(409);
    expect(store.getRuns(item.id)).toHaveLength(1);
    const copyResponse = await request(`/api/testpaqs/${item.id}/duplicate`, "POST");
    expect(copyResponse.status).toBe(201);
    const copy = await copyResponse.json();
    expect(copy.id).not.toBe(item.id);
    expect(copy.copiedFromId).toBe(item.id);
    expect(copy.archived).toBe(false);
    expect(copy.status).toBe("in_review");
    expect(
      copy.scenarios.every(
        (value: { review: string; id: string }) => value.review === "proposed" && !item.scenarios.some((entry) => entry.id === value.id),
      ),
    ).toBe(true);
    expect(copy.testCases[0].review).toBe("proposed");
    expect(copy.testCases[0].sourceSignature).toBe(caseScopeSignature(copy, copy.scenarios[0]));
    expect(store.getRuns(copy.id)).toEqual([]);
    const restored = await request(`/api/testpaqs/${item.id}/archive`, "PATCH", {
      archived: false,
      updatedAt: store.get(item.id)!.updatedAt,
    });
    expect(restored.status).toBe(200);
    expect(store.get(item.id)?.testCases).toEqual(item.testCases);
  } finally {
    store.close();
  }
});
it("persists unfinished proposals but rejects API acceptance and restore of starter text", async () => {
  const { store, item, request } = setup();
  try {
    const draft = structuredClone(item);
    draft.testCases![0].review = "proposed";
    draft.testCases![0].title = "";
    draft.testCases![0].steps[0].action = "";
    const savedResponse = await request(`/api/testpaqs/${item.id}`, "PUT", draft);
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json();
    expect(
      (await request(`/api/testpaqs/${item.id}`, "PUT", { ...saved, testCases: [{ ...saved.testCases[0], review: "accepted" }] })).status,
    ).toBe(400);
    const invalidBackup = store.backup();
    invalidBackup.testpaqs[0].testCases![0].review = "accepted";
    expect((await request("/api/workspace/restore", "POST", invalidBackup)).status).toBe(400);
    expect(store.get(item.id)?.testCases![0].review).toBe("proposed");
  } finally {
    store.close();
  }
});

it("rejects a mutation whose body arrives after the workspace has been restored", async () => {
  const { store, app, request } = setup();
  try {
    const generation = (await app.request("/api/config")).headers.get("x-testpaq-workspace")!;
    const bytes = new TextEncoder().encode(JSON.stringify({ name: "Delayed stale group" }));
    let release!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        release = controller;
      },
    });
    const pending = app.request(
      new Request("http://localhost/api/groups", {
        method: "POST",
        body,
        duplex: "half",
        headers: {
          "content-type": "application/json",
          "content-length": String(bytes.length),
          "x-testpaq-session": "test",
          "x-testpaq-workspace": generation,
        },
      } as RequestInit & { duplex: "half" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await request("/api/workspace/restore", "POST", store.backup(), generation)).status).toBe(200);
    release.enqueue(bytes);
    release.close();
    expect((await pending).status).toBe(409);
    expect(store.listGroups()).toEqual([]);
  } finally {
    store.close();
  }
});
