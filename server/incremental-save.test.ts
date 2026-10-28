// @vitest-environment node
import { expect, it } from "vitest";
import { createApp } from "./app";
import { TestpaqStore } from "./store";
import { makeFixture, reviewedFixtureCase } from "./fixture";
import { recordPatch } from "../src/shared/patch";

it("edits a valid aggregate over 5 MiB with a small patch while preserving concurrency and completed-state guards", async () => {
  const store = new TestpaqStore(":memory:");
  const item = makeFixture();
  item.testCases = Array.from({ length: 12 }, () => ({
    ...reviewedFixtureCase(item, item.scenarios[0]),
    steps: Array.from({ length: 50 }, () => ({
      id: crypto.randomUUID(),
      action: "a".repeat(5000),
      data: "",
      expectedResult: "b".repeat(5000),
    })),
  }));
  store.save(item);
  const app = createApp({ store, sessionToken: "secret", allowedOrigin: "http://localhost" });
  const send = (method: string, body: unknown) =>
    app.request(`/api/testpaqs/${item.id}`, {
      method,
      headers: { "content-type": "application/json", "x-testpaq-session": "secret" },
      body: JSON.stringify(body),
    });
  try {
    const base = store.get(item.id)!;
    expect(Buffer.byteLength(JSON.stringify(base))).toBeGreaterThan(5 * 1024 * 1024);
    const edited = { ...base, title: "Updated large Testpaq" };
    const patch = { updatedAt: base.updatedAt, operations: recordPatch(base, edited) };
    expect(JSON.stringify(patch).length).toBeLessThan(500);
    const response = await send("PATCH", patch);
    expect(response.status).toBe(200);
    expect(store.get(item.id)?.title).toBe(edited.title);
    expect(store.get(item.id)?.testCases).toEqual(base.testCases);
    expect((await send("PATCH", patch)).status).toBe(409);
    const saved = store.get(item.id)!;
    const completed = { ...saved, status: "completed" as const, completedAt: new Date().toISOString() };
    expect((await send("PATCH", { updatedAt: saved.updatedAt, operations: recordPatch(saved, completed) })).status).toBe(200);
    const closed = store.get(item.id)!;
    expect(
      (await send("PATCH", { updatedAt: closed.updatedAt, operations: recordPatch(closed, { ...closed, title: "Forbidden edit" }) }))
        .status,
    ).toBe(409);
    expect(
      (await send("PATCH", { updatedAt: closed.updatedAt, operations: [{ op: "set", path: ["__proto__", "polluted"], value: true }] }))
        .status,
    ).toBe(400);
  } finally {
    store.close();
  }
});
