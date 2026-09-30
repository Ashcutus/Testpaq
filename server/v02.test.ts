// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { makeFixture } from "./fixture";
import type { AnalysisProvider } from "./provider";
import { TestpaqStore } from "./store";
import type { AnalysisInput, AnalysisResult } from "../src/shared/domain";

const stores: TestpaqStore[] = [];
afterEach(() => {
  for (const store of stores) store.close();
  stores.length = 0;
});
const headers = { origin: "http://localhost", "x-testpaq-session": "secret", "content-type": "application/json" };
function setup(provider?: AnalysisProvider) {
  const store = new TestpaqStore(":memory:");
  stores.push(store);
  const item = makeFixture();
  store.save(item);
  const app = createApp({ store, provider, sessionToken: "secret", allowedOrigin: "http://localhost" });
  const send = (path: string, body: unknown, method = "POST") => app.request(path, { method, headers, body: JSON.stringify(body) });
  const input = {
    testpaqId: item.id,
    ticket: item.ticket,
    requirements: item.requirements,
    questions: item.questions,
    scenarios: item.scenarios,
  };
  return { store, item, app, send, input };
}
const empty: AnalysisResult = { requirements: [], scenarios: [], questions: [] };
const fakeProvider = (analyse: AnalysisProvider["analyse"], checkAccess?: () => Promise<void>): AnalysisProvider => ({
  name: "OpenAI",
  model: "test-model",
  analyse,
  checkAccess,
});

describe("v0.2 API", () => {
  it("manages persistent groups and safely ungroups Testpaqs on group removal", async () => {
    const { send, store, item } = setup();
    const created = await send("/api/groups", { name: "Fundraising" });
    expect(created.status).toBe(201);
    const group = await created.json();
    expect((await send("/api/groups", { name: "fundraising" })).status).toBe(409);
    expect((await send(`/api/testpaqs/${item.id}`, { ...item, groupId: group.id }, "PUT")).status).toBe(200);
    expect(store.list()[0].groupId).toBe(group.id);
    expect((await send(`/api/groups/${group.id}`, { name: "Ticketing" }, "PUT")).status).toBe(200);
    expect(store.listGroups()[0].name).toBe("Ticketing");
    expect((await send(`/api/groups/${group.id}`, undefined, "DELETE")).status).toBe(204);
    expect(store.get(item.id)?.groupId).toBeUndefined();
    expect(store.get(item.id)?.scenarios).toHaveLength(item.scenarios.length);
  });
  it("rejects saves from stale tabs and cannot recreate deleted Testpaqs", async () => {
    const { send, store, item } = setup();
    expect((await send(`/api/testpaqs/${item.id}`, { ...item, title: "Updated in tab one" }, "PUT")).status).toBe(200);
    expect((await send(`/api/testpaqs/${item.id}`, { ...item, title: "Stale tab two" }, "PUT")).status).toBe(409);
    expect(store.get(item.id)?.title).toBe("Updated in tab one");
    store.remove(item.id);
    expect((await send(`/api/testpaqs/${item.id}`, item, "PUT")).status).toBe(404);
  });
  it("returns actionable billing failures and records the real error code", async () => {
    const { send, store, input, item } = setup(
      fakeProvider(async () => {
        throw { status: 429, code: "insufficient_quota", message: "Sensitive content" };
      }),
    );
    const response = await send("/api/analyse", input);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "insufficient_quota",
      billingUrl: "https://platform.openai.com/settings/organization/billing/overview",
    });
    expect(store.get(item.id)).toEqual(item);
    expect(store.getRuns(item.id)[0].errorCode).toBe("insufficient_quota");
  });
  it("checks billing access only on explicit request, reporting a billing error rather than connected", async () => {
    const check = vi.fn(async () => {
      throw { status: 429, code: "credit_balance_exhausted" };
    });
    const { app, send } = setup(fakeProvider(async () => empty, check));
    const config = await (await app.request("/api/config")).json();
    expect(config.providerStatus.status).toBe("unchecked");
    expect(check).not.toHaveBeenCalled();
    const response = await send("/api/provider/check", {});
    expect(await response.json()).toMatchObject({
      configured: true,
      providerStatus: { status: "error", code: "credit_balance_exhausted" },
    });
    expect(check).toHaveBeenCalledOnce();
  });
  it("persists a successful refresh with its answers and exact history snapshot atomically", async () => {
    const analyse = vi.fn(async (_input: AnalysisInput) => empty);
    const { send, store, input, item } = setup(fakeProvider(analyse));
    const response = await send("/api/analyse", input);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item.lastAnalysedSignature).toBeTruthy();
    expect(store.get(item.id)).toEqual(body.item);
    expect(store.getRuns(item.id)[0]).toMatchObject({
      status: "succeeded",
      promptVersion: "testpaq-analysis-v2",
      inputSnapshot: JSON.parse(JSON.stringify(input)),
    });
    expect(analyse.mock.calls[0][0].questions).toEqual(item.questions);
  });
  it("rejects stale input before sending it to the provider", async () => {
    const analyse = vi.fn(async () => empty);
    const { send, input } = setup(fakeProvider(analyse));
    const response = await send("/api/analyse", { ...input, ticket: { ...input.ticket, title: "Unsaved edit" } });
    expect(response.status).toBe(409);
    expect(analyse).not.toHaveBeenCalled();
  });
  it("does not overwrite edits made in another tab during a running analysis", async () => {
    let release!: (result: AnalysisResult) => void;
    const entered = Promise.withResolvers<void>();
    const { send, store, input, item } = setup(
      fakeProvider(() => {
        entered.resolve();
        return new Promise((resolve) => {
          release = resolve;
        });
      }),
    );
    const pending = send("/api/analyse", input);
    await entered.promise;
    expect((await send("/api/analyse", input)).status).toBe(409);
    await send(`/api/testpaqs/${item.id}`, { ...item, title: "Edited while analysing" }, "PUT");
    release(empty);
    expect((await pending).status).toBe(409);
    expect(store.get(item.id)?.title).toBe("Edited while analysing");
    expect(store.getRuns(item.id)[0]).toMatchObject({ status: "failed", errorCode: "analysis_conflict" });
  });
  it("rolls back the run result if persistence of the merged Testpaq fails", async () => {
    const { send, store, input, item } = setup(fakeProvider(async () => empty));
    vi.spyOn(store, "save").mockImplementationOnce(() => {
      throw new Error("Simulated persistence failure");
    });
    expect((await send("/api/analyse", input)).status).toBe(502);
    expect(store.get(item.id)).toEqual(item);
    expect(store.getRuns(item.id)[0]).toMatchObject({ status: "failed", result: undefined });
  });
  it("returns a clear error for malformed JSON", async () => {
    const { app } = setup();
    expect((await app.request("/api/testpaqs", { method: "POST", headers, body: "{" })).status).toBe(400);
  });
});
