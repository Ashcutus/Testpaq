import { describe, expect, it } from "vitest";
import { makeFixture, reviewedFixtureCase } from "../../server/fixture";
import { TestpaqSchema } from "./domain";
import { applyGeneratedCases, caseNeedsReview, eligibleCases, newTestCase } from "./test-cases";
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
