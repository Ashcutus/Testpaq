// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

it("upgrades a v0.1 database without altering Testpaqs or analysis snapshots", () => {
  const dir = mkdtempSync(join(tmpdir(), "testpaq-migration-"));
  const path = join(dir, "testpaq.db");
  try {
    const old = new TestpaqStore(path);
    const fixture = makeFixture();
    old.save(fixture);
    const inputSnapshot = { testpaqId: fixture.id, ticket: fixture.ticket, requirements: fixture.requirements };
    old.startRun({
      testpaqId: fixture.id,
      provider: "test",
      model: "test",
      promptVersion: "v1",
      disclosure: "test",
      inputHash: "test",
      inputSnapshot,
    });
    old.database.exec("DROP TABLE project_groups; PRAGMA user_version=2;");
    old.close();
    const migrated = new TestpaqStore(path);
    try {
      expect(migrated.database.pragma("user_version", { simple: true })).toBe(3);
      expect(migrated.get(fixture.id)).toEqual(fixture);
      expect(migrated.listGroups()).toEqual([]);
      expect(migrated.getRuns(fixture.id)[0]).toMatchObject({ errorCode: "interrupted", status: "failed", inputSnapshot });
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
