import { expect, it } from "vitest";
import { makeFixture, reviewedFixtureCase } from "../../server/fixture";
import { applyCaseRevision, applyGeneratedCases, eligibleCases } from "./test-cases";
import { workflowSummary } from "./workflow";

it("applies a reviewed revision preserving identity and destinations, and rejects stale revisions", () => {
  const item = makeFixture();
  const target = { ...reviewedFixtureCase(item, item.scenarios[0]), introducedInRun: crypto.randomUUID(), review: "accepted" as const };
  item.testCases = [target];
  const fields = {
    clientId: "revision",
    title: "Revised case",
    objective: "Verify clarified behaviour",
    preconditions: "Owner signed in",
    postconditions: "",
    steps: [{ action: "Reload", data: "", expectedResult: "Hidden" }],
    unknowns: [],
  };
  const proposed = applyGeneratedCases(item, target.scenarioId, { testCases: [fields] }, crypto.randomUUID(), target.id);
  expect(eligibleCases(proposed).map((value) => value.id)).toEqual([target.id]);
  const revised = applyCaseRevision(proposed, proposed.testCases![1].id);
  expect(revised.testCases).toHaveLength(1);
  expect(revised.testCases![0]).toMatchObject({
    id: target.id,
    destinations: target.destinations,
    review: "proposed",
    title: "Revised case",
  });
  expect(revised.testCases![0].introducedInRun).toBe(target.introducedInRun);
  expect(revised.testCases![0].lastChangedInRun).toBe(proposed.testCases![1].introducedInRun);
  const edited = structuredClone(proposed);
  edited.testCases![0].objective = "New human edit";
  expect(() => applyCaseRevision(edited, edited.testCases![1].id)).toThrow("no longer current");
  const changedScope = structuredClone(proposed);
  changedScope.ticket.description += "Changed again";
  expect(() => applyCaseRevision(changedScope, changedScope.testCases![1].id)).toThrow("no longer current");
});
it("reports gaps, missing cases and separate Manual/Qase readiness without treating proposals as ready", () => {
  const item = makeFixture();
  const parent = item.scenarios[0];
  const target = {
    ...reviewedFixtureCase(item, parent),
    review: "accepted" as const,
    destinations: { manual: true, qase: false, automation: false },
  };
  item.testCases = [target];
  expect(workflowSummary(item).manual).toHaveLength(1);
  expect(workflowSummary(item).qase).toHaveLength(0);
  expect(workflowSummary(item).needsCases.some((value) => value.id === parent.id)).toBe(false);
  item.requirements.push({
    id: crypto.randomUUID(),
    text: "New manually added behaviour",
    source: "human",
    active: true,
    createdAt: item.createdAt,
  });
  expect(workflowSummary(item).uncovered.some((value) => value.text === "New manually added behaviour")).toBe(true);
  item.ticket.description += "Clarified scope";
  expect(workflowSummary(item).manual).toHaveLength(0);
  expect(workflowSummary(item).scopeReview).toHaveLength(1);
});

it("invalidates only cases linked to changed feedback, while global answers affect all coverage", () => {
  const item = makeFixture();
  const first = item.scenarios[0],
    second = item.scenarios[1];
  item.questions = [
    {
      id: crypto.randomUUID(),
      text: "Which view needs checking?",
      origin: "human",
      status: "open",
      scenarioId: first.id,
      createdAt: item.createdAt,
    },
  ];
  item.testCases = [reviewedFixtureCase(item, first), reviewedFixtureCase(item, second)];
  item.questions[0].status = "resolved";
  item.questions[0].resolution = "Check the owner view.";
  expect(workflowSummary(item).scopeReview.map((value) => value.scenarioId)).toEqual([first.id]);
  item.questions.push({
    id: crypto.randomUUID(),
    text: "Which environment?",
    origin: "human",
    status: "resolved",
    resolution: "Staging",
    createdAt: item.createdAt,
  });
  expect(workflowSummary(item).scopeReview).toHaveLength(2);
});
