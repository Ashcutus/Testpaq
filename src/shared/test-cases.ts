import {
  CaseGenerationResultSchema,
  TestCaseSchema,
  TestpaqSchema,
  type CaseGenerationResult,
  type Scenario,
  type TestCase,
  type Testpaq,
} from "./domain.js";

/** Exact scope snapshot; timestamps and review/destination changes do not invalidate cases. */
export function caseScopeSignature(item: Testpaq, scenario: Scenario): string {
  return JSON.stringify({
    ticket: item.ticket,
    coverage: {
      title: scenario.title,
      expectedOutcome: scenario.expectedOutcome,
      category: scenario.category,
      rationale: scenario.rationale,
      risks: scenario.risks,
    },
    requirements: scenario.requirementIds.map((id) => item.requirements.find((value) => value.id === id)),
    answers: item.questions.filter((value) => value.status === "resolved").map(({ id, text, resolution }) => ({ id, text, resolution })),
  });
}
export function caseNeedsReview(item: Testpaq, value: TestCase): boolean {
  const parent = item.scenarios.find((scenario) => scenario.id === value.scenarioId);
  return !parent || Boolean(parent.scopeReviewRequired) || value.sourceSignature !== caseScopeSignature(item, parent);
}
export function eligibleCases(item: Testpaq): TestCase[] {
  return (item.testCases ?? []).filter((value) => {
    const parent = item.scenarios.find((scenario) => scenario.id === value.scenarioId);
    return (
      value.review === "accepted" &&
      !value.archived &&
      !value.unknowns.length &&
      parent?.review === "accepted" &&
      !parent.archived &&
      !caseNeedsReview(item, value)
    );
  });
}
export function newTestCase(item: Testpaq, parent: Scenario, legacy = false): TestCase {
  const timestamp = new Date().toISOString();
  return TestCaseSchema.parse({
    id: crypto.randomUUID(),
    scenarioId: parent.id,
    title: legacy ? parent.title : "New test case",
    objective: parent.expectedOutcome,
    preconditions: "",
    postconditions: "",
    steps: [
      { id: crypto.randomUUID(), action: legacy ? parent.title : "Describe the action", data: "", expectedResult: parent.expectedOutcome },
    ],
    unknowns: legacy ? ["Review this converted coverage summary and add the setup, data and detailed steps."] : [],
    review: "proposed",
    origin: legacy ? "legacy" : "human",
    destinations: { ...parent.destinations },
    sourceSignature: caseScopeSignature(item, parent),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
export function testCaseContentSignature(
  value: Pick<TestCase, "title" | "objective" | "preconditions" | "postconditions" | "steps" | "unknowns">,
): string {
  return JSON.stringify({
    title: value.title,
    objective: value.objective,
    preconditions: value.preconditions,
    postconditions: value.postconditions,
    steps: value.steps.map(({ action, data, expectedResult }) => ({ action, data, expectedResult })),
    unknowns: value.unknowns,
  });
}
export function applyGeneratedCases(input: Testpaq, scenarioId: string, result: CaseGenerationResult, runId: string): Testpaq {
  const item = structuredClone(input);
  const parent = item.scenarios.find((value) => value.id === scenarioId);
  if (!parent || parent.review !== "accepted" || parent.archived || parent.scopeReviewRequired)
    throw new Error("Coverage must be accepted and current before drafting test cases.");
  const validated = CaseGenerationResultSchema.parse(result);
  const timestamp = new Date(Math.max(Date.now(), Date.parse(input.updatedAt) + 1)).toISOString();
  item.testCases ??= [];
  // Identical proposals are skipped. Existing cases, review decisions and human edits are never replaced.
  for (const proposed of validated.testCases) {
    const { clientId: _clientId, ...fields } = proposed;
    const steps = fields.steps.map((value) => ({ ...value, id: crypto.randomUUID() }));
    const candidate = { ...fields, steps };
    if (
      item.testCases.some(
        (value) => value.scenarioId === parent.id && testCaseContentSignature(value) === testCaseContentSignature(candidate),
      )
    )
      continue;
    item.testCases.push({
      ...candidate,
      id: crypto.randomUUID(),
      scenarioId: parent.id,
      origin: "generated",
      review: "proposed",
      destinations: { ...parent.destinations },
      sourceSignature: caseScopeSignature(item, parent),
      introducedInRun: runId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  item.status = "in_review";
  delete item.exportedAt;
  item.updatedAt = timestamp;
  return TestpaqSchema.parse(item);
}
