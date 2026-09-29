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
});
