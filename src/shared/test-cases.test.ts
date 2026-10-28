import { describe, expect, it } from "vitest";
import { makeFixture, reviewedFixtureCase } from "../../server/fixture";
import { TestpaqSchema } from "./domain";
import { applyGeneratedBatch, applyGeneratedCases, caseNeedsReview, eligibleCases, newTestCase, pendingRevision } from "./test-cases";
import { updatableCases } from "./workflow";
import { compactScopeSignature, caseScopeChanges, scopeQuestions } from "./test-cases";
import { createHash } from "node:crypto";
import { renderQaseCsv } from "./qase";
import { applyAnalysis } from "./analysis";
const proposal = {
  clientId: "reload",
  title: "Visibility persists after reload",
  objective: "Verify stored preference",
  preconditions: "Owner has a campaign",
  postconditions: "Restore visible state",
  steps: [
    { action: "Hide amount", data: "", expectedResult: "Amount is hidden" },
    { action: "Reload", data: "", expectedResult: "Amount stays hidden" },
  ],
  unknowns: [],
};

it("compacts recorded legacy scope with native-compatible SHA-256 while preserving stale diagnostics", () => {
  const item = makeFixture();
  item.ticket.description = "Unicode £ café 🧪".repeat(1000);
  const parent = item.scenarios[0];
  const baseline = {
    ticket: item.ticket,
    coverage: {
      title: parent.title,
      expectedOutcome: parent.expectedOutcome,
      category: parent.category,
      rationale: parent.rationale,
      risks: parent.risks,
    },
    requirements: parent.requirementIds.map((id) => item.requirements.find((value) => value.id === id)),
    answers: scopeQuestions(item, parent)
      .filter((value) => value.status === "resolved")
      .map(({ id, text, resolution }) => ({ id, text, resolution })),
  };
  const legacy = JSON.stringify(baseline);
  const compact = compactScopeSignature(legacy);
  expect(compact.length).toBeLessThan(400);
  expect(JSON.parse(compact).ticket).toBe(createHash("sha256").update(JSON.stringify(baseline.ticket)).digest("hex"));
  const value = { ...reviewedFixtureCase(item, parent), sourceSignature: legacy };
  expect(caseNeedsReview(item, value)).toBe(false);
  item.ticket.description += " changed";
  expect(caseNeedsReview(item, value)).toBe(true);
  expect(caseScopeChanges(item, value)).toContain("Ticket context");
  expect(caseScopeChanges(item, { ...value, sourceSignature: compact })).toEqual(caseScopeChanges(item, value));
});
describe("linked test cases", () => {
  it("adds multiple proposals under one output, preserves decisions and skips exact duplicates", () => {
    const item = makeFixture();
    const parent = item.scenarios[0];
    const existing = { ...reviewedFixtureCase(item, parent), review: "accepted" as const };
    item.testCases = [existing];
    const runId = crypto.randomUUID();
    const result = { testCases: [proposal, { ...proposal, clientId: "login", title: "Visibility persists after signing back in" }] };
    const applied = applyGeneratedCases(item, parent.id, result, runId);
    expect(applied.testCases).toHaveLength(3);
    expect(applied.testCases![0]).toEqual(existing);
    expect(
      applied
        .testCases!.slice(1)
        .every((value) => value.scenarioId === parent.id && value.review === "proposed" && value.introducedInRun === runId),
    ).toBe(true);
    expect(applyGeneratedCases(applied, parent.id, result, crypto.randomUUID()).testCases).toHaveLength(3);
    expect(item.testCases).toHaveLength(1);
  });
  it("keeps scope review separate from case acceptance and never exports stale or archived coverage", () => {
    const item = makeFixture();
    const parent = item.scenarios[0];
    item.testCases = [{ ...reviewedFixtureCase(item, parent), review: "accepted" }];
    expect(eligibleCases(item)).toHaveLength(1);
    parent.destinations.qase = !parent.destinations.qase;
    expect(caseNeedsReview(item, item.testCases[0])).toBe(false);
    item.ticket.qaContext += "New permission constraint";
    expect(caseNeedsReview(item, item.testCases[0])).toBe(true);
    expect(eligibleCases(item)).toEqual([]);
    expect(renderQaseCsv(item).split("\r\n")).toHaveLength(2);
    const restored = makeFixture();
    restored.testCases = [{ ...reviewedFixtureCase(restored, restored.scenarios[0]), review: "accepted" }];
    restored.scenarios[0].archived = true;
    expect(eligibleCases(restored)).toEqual([]);
    expect(restored.testCases[0].review).toBe("accepted");
  });
  it("does not silently convert legacy coverage and rejects broken cases or unresolved acceptance", () => {
    const item = makeFixture();
    expect(renderQaseCsv(item).split("\r\n")).toHaveLength(2);
    const legacy = newTestCase(item, item.scenarios[0], true);
    expect(legacy.review).toBe("proposed");
    expect(legacy.unknowns.length).toBeGreaterThan(0);
    item.testCases = [legacy];
    expect(TestpaqSchema.safeParse(item).success).toBe(true);
    legacy.review = "accepted";
    expect(TestpaqSchema.safeParse(item).success).toBe(false);
    legacy.review = "proposed";
    legacy.scenarioId = crypto.randomUUID();
    expect(TestpaqSchema.safeParse(item).success).toBe(false);
    legacy.scenarioId = item.scenarios[0].id;
    item.testCases.push(structuredClone(legacy));
    expect(TestpaqSchema.safeParse(item).success).toBe(false);
  });
  it("retains detailed cases during coverage refresh", () => {
    const item = makeFixture();
    item.testCases = [{ ...reviewedFixtureCase(item, item.scenarios[0]), review: "accepted" }];
    const refreshed = applyAnalysis(item, { requirements: [], scenarios: [], questions: [] });
    expect(refreshed.testCases).toEqual(item.testCases);
  });
});
it("creates only Manual/Qase defaults from historical parent plans, preserving existing case plans", () => {
  const item = makeFixture();
  const parent = item.scenarios[0];
  parent.destinations = { manual: true, qase: false, automation: true };
  expect(newTestCase(item, parent).destinations).toEqual({ manual: true, qase: true, automation: false });
  const existing = { ...newTestCase(item, parent), destinations: { ...parent.destinations } };
  item.testCases = [existing];
  const drafted = applyGeneratedCases(item, parent.id, { testCases: [proposal] }, crypto.randomUUID());
  expect(drafted.testCases![0].destinations).toEqual(existing.destinations);
  expect(drafted.testCases![1].destinations).toEqual({ manual: true, qase: true, automation: false });
});

it("keeps one waiting proposal per case when a batch asks for another update", () => {
  const item = makeFixture();
  const parent = item.scenarios[0];
  const original = { ...newTestCase(item, parent), title: "Original", review: "accepted" as const };
  original.steps = [{ id: crypto.randomUUID(), action: "Do it", data: "", expectedResult: "It works" }];
  item.testCases = [original];
  const revision = (clientId: string) => ({
    clientId,
    scenarioId: parent.id,
    replacesCaseId: original.id,
    title: `Revised ${clientId}`,
    description: "Verify it",
    preconditions: "",
    steps: [{ action: "Do it again", data: "", expectedResult: "It still works" }],
  });
  const first = applyGeneratedBatch(item, [parent.id], [original.id], { testCases: [revision("a")] }, crypto.randomUUID());
  expect(first.item.testCases).toHaveLength(2);
  expect(first.revised).toBe(1);
  const second = applyGeneratedBatch(first.item, [parent.id], [original.id], { testCases: [revision("b")] }, crypto.randomUUID());
  expect(second.item.testCases).toHaveLength(2);
  expect(second.item.testCases![1].title).toBe("Revised a");
  // A waiting proposal already satisfies the request, so it is not reported as missing.
  expect(second.missingUpdateCaseIds).toEqual([]);
});

it("ignores entries for unknown coverage or cases instead of failing the whole response", () => {
  const item = makeFixture();
  const parent = item.scenarios[0];
  const stray = {
    title: "Stray",
    description: "Not ours",
    preconditions: "",
    steps: [{ action: "Act", data: "", expectedResult: "Result" }],
  };
  const result = {
    testCases: [
      { ...stray, clientId: "a", scenarioId: "not-a-uuid", replacesCaseId: undefined },
      { ...stray, clientId: "b", scenarioId: parent.id, replacesCaseId: "also-not-a-uuid" },
    ],
  };
  const applied = applyGeneratedBatch(item, [parent.id], [], result, crypto.randomUUID());
  expect(applied.item.testCases ?? []).toHaveLength(0);
});

const changedCase = () => {
  const item = makeFixture();
  const parent = item.scenarios[0];
  const original = { ...newTestCase(item, parent), title: "Original", review: "accepted" as const };
  original.steps = [{ id: crypto.randomUUID(), action: "Do it", data: "", expectedResult: "It works" }];
  item.testCases = [original];
  item.ticket.description += " Scope moved on.";
  const revision = (clientId: string) => ({
    clientId,
    scenarioId: parent.id,
    replacesCaseId: original.id,
    title: `Revised ${clientId}`,
    description: "Verify it",
    preconditions: "",
    steps: [{ action: "Do it again", data: "", expectedResult: "It still works" }],
  });
  return { item, parent, original, revision };
};

it("allows a new update after a proposal was rejected, archived or went stale", () => {
  const { item, parent, original, revision } = changedCase();
  expect(updatableCases(item).map((value) => value.id)).toEqual([original.id]);
  const proposed = applyGeneratedBatch(item, [parent.id], [original.id], { testCases: [revision("a")] }, crypto.randomUUID()).item;
  expect(pendingRevision(proposed, proposed.testCases![0])).toBeDefined();
  expect(updatableCases(proposed)).toEqual([]);
  const rejected = structuredClone(proposed);
  rejected.testCases![1].review = "rejected";
  expect(updatableCases(rejected).map((value) => value.id)).toEqual([original.id]);
  const archived = structuredClone(proposed);
  archived.testCases![1].archived = true;
  expect(updatableCases(archived).map((value) => value.id)).toEqual([original.id]);
  const stale = structuredClone(proposed);
  stale.testCases![0].steps[0].action = "Edited after the proposal";
  expect(updatableCases(stale).map((value) => value.id)).toEqual([original.id]);
  const again = applyGeneratedBatch(rejected, [parent.id], [original.id], { testCases: [revision("b")] }, crypto.randomUUID());
  expect(again.revised).toBe(1);
  expect(again.item.testCases).toHaveLength(3);
});

it("reports requested updates the response did not return instead of treating them as done", () => {
  const { item, parent, original } = changedCase();
  const result = applyGeneratedBatch(item, [parent.id], [original.id], { testCases: [] }, crypto.randomUUID());
  expect(result).toMatchObject({ added: 0, revised: 0, missingUpdateCaseIds: [original.id] });
});

it("applies more than 30 cases for one coverage output and never exceeds the case limit", () => {
  const item = makeFixture();
  const parent = item.scenarios[0];
  const many = (count: number, prefix = "n") =>
    Array.from({ length: count }, (_, index) => ({
      clientId: `${prefix}${index}`,
      scenarioId: parent.id,
      replacesCaseId: undefined,
      title: `Case ${prefix}${index}`,
      description: "Verify it",
      preconditions: "",
      steps: [{ action: `Act ${prefix}${index}`, data: "", expectedResult: "Result" }],
    }));
  const first = applyGeneratedBatch(item, [parent.id], [], { testCases: many(75) }, crypto.randomUUID());
  expect(first.added).toBe(75);
  expect(first.item.testCases).toHaveLength(75);
  const nearLimit = structuredClone(first.item);
  nearLimit.testCases = Array.from({ length: 2990 }, (_, index) => ({
    ...first.item.testCases![0],
    id: crypto.randomUUID(),
    title: `Filler ${index}`,
    steps: first.item.testCases![0].steps.map((step) => ({ ...step, id: crypto.randomUUID() })),
  }));
  const capped = applyGeneratedBatch(nearLimit, [parent.id], [], { testCases: many(40, "x") }, crypto.randomUUID());
  expect(capped.item.testCases).toHaveLength(3000);
  expect(capped.added).toBe(10);
  expect(capped.capacitySkippedNewCases).toBe(30);
  expect(capped.capacitySkippedUpdateCaseIds).toEqual([]);
});

it("does not classify duplicate additions as capacity skips or skip unique cases behind duplicates", () => {
  const { item, parent, original, revision } = changedCase();
  const first = { ...revision("a"), replacesCaseId: undefined };
  const populated = applyGeneratedBatch(item, [parent.id], [], { testCases: [first] }, crypto.randomUUID()).item;
  const existing = populated.testCases![1];
  populated.testCases = [
    original,
    existing,
    ...Array.from({ length: 2997 }, (_, index) => ({ ...original, id: crypto.randomUUID(), title: `Filler ${index}` })),
  ];
  const distinct = { ...first, clientId: "b", title: "Distinct test" };
  const applied = applyGeneratedBatch(populated, [parent.id], [], { testCases: [first, distinct] }, crypto.randomUUID());
  expect(applied).toMatchObject({ added: 1, capacitySkippedNewCases: 0, missingUpdateCaseIds: [], capacitySkippedUpdateCaseIds: [] });
  expect(applied.item.testCases!.at(-1)!.title).toBe("Distinct test");
});
