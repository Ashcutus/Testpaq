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
      expect(migrated.database.pragma("user_version", { simple: true })).toBe(7);
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

it("upgrades v0.2 preserving groups, payloads and completed analysis history", () => {
  const dir = mkdtempSync(join(tmpdir(), "testpaq-v03-migration-"));
  const path = join(dir, "testpaq.db");
  try {
    const old = new TestpaqStore(path);
    const group = old.saveGroup("Existing project");
    const item = { ...makeFixture(), groupId: group.id };
    old.save(item);
    const run = old.startRun({
      testpaqId: item.id,
      provider: "OpenAI",
      model: "old-model",
      promptVersion: "v2",
      disclosure: "test",
      inputHash: "hash",
    });
    old.finishRun(run.id, { requirements: [], scenarios: [], questions: [] });
    old.database.exec("DROP TABLE settings; PRAGMA user_version=3;");
    old.close();
    const migrated = new TestpaqStore(path);
    try {
      expect(migrated.get(item.id)).toEqual(item);
      expect(migrated.listGroups()).toEqual([group]);
      expect(migrated.getRuns(item.id)[0]).toMatchObject({ id: run.id, status: "succeeded", model: "old-model" });
      expect(migrated.database.pragma("foreign_key_check")).toEqual([]);
      migrated.save({ ...item, status: "completed", completedAt: new Date().toISOString() });
      expect(migrated.get(item.id)?.status).toBe("completed");
      migrated.remove(item.id);
      expect(migrated.getRuns(item.id)).toEqual([]);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects a second workspace owner without interrupting its running analysis", () => {
  const dir = mkdtempSync(join(tmpdir(), "testpaq-owner-"));
  const path = join(dir, "testpaq.db");
  try {
    const first = new TestpaqStore(path);
    const item = makeFixture();
    first.save(item);
    first.startRun({ testpaqId: item.id, provider: "test", model: "test", promptVersion: "v3", disclosure: "test", inputHash: "hash" });
    expect(() => new TestpaqStore(path)).toThrow(/already running/);
    expect(first.getRuns(item.id)[0].status).toBe("running");
    first.close();
    const reopened = new TestpaqStore(path);
    expect(reopened.getRuns(item.id)[0].errorCode).toBe("interrupted");
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("round trips groups, Testpaqs, history and model preference and rejects invalid restores atomically", () => {
  const store = new TestpaqStore(":memory:");
  const restored = new TestpaqStore(":memory:");
  try {
    const group = store.saveGroup("QA project");
    const item = { ...makeFixture(), groupId: group.id };
    store.save(item);
    store.setSetting("openai_model", "selected-model");
    const run = store.startRun({
      testpaqId: item.id,
      provider: "OpenAI",
      model: "selected-model",
      promptVersion: "v3",
      disclosure: "test",
      inputHash: "hash",
    });
    store.finishRun(run.id, { requirements: [], scenarios: [], questions: [] });
    const backup = store.backup();
    restored.restore(backup);
    expect(restored.get(item.id)).toEqual({ ...item, updatedAt: restored.get(item.id)!.updatedAt });
    expect(restored.get(item.id)!.updatedAt).not.toBe(item.updatedAt);
    expect(restored.listGroups()).toEqual([group]);
    expect(restored.getRuns(item.id)).toEqual(store.getRuns(item.id));
    expect(restored.getSetting("openai_model")).toBe("selected-model");
    expect(() => restored.restore({ ...backup, testpaqs: [{ ...item, groupId: crypto.randomUUID() }] })).toThrow();
    expect(restored.get(item.id)).toEqual({ ...item, updatedAt: restored.get(item.id)!.updatedAt });
    expect(restored.get(item.id)!.updatedAt).not.toBe(item.updatedAt);
    expect(restored.database.pragma("foreign_key_check")).toEqual([]);
  } finally {
    store.close();
    restored.close();
  }
});

it("paginates summaries and searches the complete workspace with literal wildcard text", () => {
  const store = new TestpaqStore(":memory:");
  try {
    for (let index = 0; index < 105; index++) store.save({ ...makeFixture(), title: `Work ${index}` });
    const target = { ...makeFixture(), title: "100% ready_" };
    store.save(target);
    const first = store.list(100);
    const next = store.list(100, 100);
    expect(first).toHaveLength(100);
    expect(next).toHaveLength(6);
    expect(new Set([...first, ...next].map((item) => item.id)).size).toBe(106);
    expect(store.list(100, 0, "100% ready_").map((item) => item.id)).toEqual([target.id]);
  } finally {
    store.close();
  }
});

it("retains old approval content and historical snapshots when starter approvals need renewed review", () => {
  const dir = mkdtempSync(join(tmpdir(), "testpaq-authoring-migration-"));
  const path = join(dir, "testpaq.db");
  try {
    const old = new TestpaqStore(path);
    const item = makeFixture();
    old.save(item);
    const badCase = {
      id: crypto.randomUUID(),
      scenarioId: item.scenarios[0].id,
      title: "New test case",
      objective: item.scenarios[0].expectedOutcome,
      preconditions: "",
      postconditions: "",
      steps: [{ id: crypto.randomUUID(), action: "Describe the action", data: "", expectedResult: "Expected behaviour" }],
      unknowns: [],
      review: "accepted",
      origin: "human",
      destinations: { manual: true, qase: true, automation: false },
      sourceSignature: "legacy",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    old.database.prepare("UPDATE testpaqs SET payload=? WHERE id=?").run(JSON.stringify({ ...item, testCases: [badCase] }), item.id);
    const run = old.startRun({
      testpaqId: item.id,
      provider: "fixture",
      model: "fixture",
      promptVersion: "v1",
      disclosure: "fixture",
      inputHash: "fixture",
      inputSnapshot: { testpaqId: item.id, ticket: item.ticket, requirements: item.requirements, testCases: [badCase] } as never,
    });
    old.finishRun(run.id, { requirements: [], scenarios: [], questions: [] });
    old.database.pragma("user_version = 6");
    old.close();
    const upgraded = new TestpaqStore(path);
    try {
      const saved = upgraded.get(item.id)!;
      expect(saved.testCases![0]).toMatchObject({ title: badCase.title, steps: badCase.steps, review: "proposed" });
      expect(saved.reviewNotice).toContain("older starter-text approvals");
      expect(upgraded.getRuns(item.id)[0].inputSnapshot?.testCases![0].review).toBe("accepted");
      expect(upgraded.database.pragma("user_version", { simple: true })).toBe(7);
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
