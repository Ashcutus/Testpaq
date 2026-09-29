// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makeFixture } from "./fixture";
import { TestpaqStore } from "./store";

describe("TestpaqStore", () => {
  it("persists and reloads the complete aggregate", () => {
    const store = new TestpaqStore(":memory:");
    const fixture = makeFixture();
    store.save(fixture);
    expect(store.get(fixture.id)).toEqual(fixture);
    expect(store.list()[0]).toMatchObject({ id: fixture.id, scenarioCount: 17, openQuestionCount: 2 });
    expect(store.database.pragma("foreign_keys", { simple: true })).toBe(1);
    store.close();
  });

  it("persists the exact analysis input snapshot with a run", () => {
    const store = new TestpaqStore(":memory:");
    const fixture = makeFixture();
    store.save(fixture);
    const inputSnapshot = { testpaqId: fixture.id, ticket: fixture.ticket, requirements: fixture.requirements };
    const run = store.startRun({
      testpaqId: fixture.id,
      provider: "test",
      model: "test-model",
      promptVersion: "test-v1",
      disclosure: "Test snapshot",
      inputHash: "abc123",
      inputSnapshot,
    });
    expect(store.getRuns(fixture.id)[0]).toMatchObject({ id: run.id, inputSnapshot });
    store.close();
  });
});
