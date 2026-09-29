// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { AnalysisProvider } from "./provider";
import { TestpaqStore } from "./store";
import { makeFixture } from "./fixture";

describe("local API security and validation", () => {
  const make = () => {
    const store = new TestpaqStore(":memory:");
    return { store, app: createApp({ store, sessionToken: "secret", allowedOrigin: "http://127.0.0.1:4321" }) };
  };
  it("rejects mutations without the launch token", async () => {
    const { app, store } = make();
    const response = await app.request("/api/testpaqs", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4321", "content-type": "application/json" },
      body: JSON.stringify({ title: "A test" }),
    });
    expect(response.status).toBe(403);
    store.close();
  });
  it("rejects a foreign browser origin", async () => {
    const { app, store } = make();
    const response = await app.request("/api/testpaqs", {
      method: "POST",
      headers: { origin: "http://evil.test", "x-testpaq-session": "secret", "content-type": "application/json" },
      body: JSON.stringify({ title: "A test" }),
    });
    expect(response.status).toBe(403);
    store.close();
  });
  it("validates API input and accepts a valid local mutation", async () => {
    const { app, store } = make();
    const bad = await app.request("/api/testpaqs", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4321", "x-testpaq-session": "secret", "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(bad.status).toBe(400);
    const good = await app.request("/api/testpaqs", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4321", "x-testpaq-session": "secret", "content-type": "application/json" },
      body: JSON.stringify({ title: "A test" }),
    });
    expect(good.status).toBe(201);
    expect(store.list()).toHaveLength(1);
    store.close();
  });

  it("records and rejects malformed provider output without changing the Testpaq", async () => {
    const store = new TestpaqStore(":memory:");
    const fixture = makeFixture();
    store.save(fixture);
    const provider: AnalysisProvider = {
      name: "Invalid fixture provider",
      model: "invalid-test",
      analyse: async () =>
        ({
          requirements: [{ clientId: "r1", text: "A requirement", source: "acceptance_criteria" }],
          scenarios: [
            {
              clientId: "s1",
              title: "Broken explicit scenario",
              expectedOutcome: "Something happens",
              origin: "explicit",
              category: "happy_path",
              requirementClientIds: [],
              risks: [],
            },
          ],
          questions: [],
        }) as never,
    };
    const app = createApp({ store, provider, sessionToken: "secret", allowedOrigin: "http://127.0.0.1:4321" });
    const response = await app.request("/api/analyse", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4321", "x-testpaq-session": "secret", "content-type": "application/json" },
      body: JSON.stringify({ testpaqId: fixture.id, ticket: fixture.ticket, requirements: fixture.requirements }),
    });
    expect(response.status).toBe(502);
    expect(store.get(fixture.id)).toEqual(fixture);
    expect(store.getRuns(fixture.id)[0]).toMatchObject({ status: "failed", errorCode: "invalid_analysis" });
    store.close();
  });
});
