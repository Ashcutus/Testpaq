import { caseContentIssues } from "./authoring.js";
import {
  CaseGenerationResultSchema,
  TestCaseSchema,
  TestpaqSchema,
  type CaseGenerationResult,
  type Scenario,
  type TestCase,
  type Testpaq,
} from "./domain.js";

export function scopeQuestions(item: Testpaq, scenario: Scenario) {
  return item.questions.filter(
    (question) =>
      (!question.scenarioId && !question.requirementId) ||
      question.scenarioId === scenario.id ||
      Boolean(question.requirementId && scenario.requirementIds.includes(question.requirementId)),
  );
}
export function caseScopeChanges(item: Testpaq, value: TestCase): string[] {
  const parent = item.scenarios.find((scenario) => scenario.id === value.scenarioId);
  if (!parent) return ["Parent coverage is missing"];
  const changes: string[] = parent.scopeReviewRequired ? ["Parent coverage needs review"] : [];
  try {
    const before = JSON.parse(value.sourceSignature),
      after = JSON.parse(caseScopeSignature(item, parent));
    for (const [key, text] of [
      ["ticket", "Ticket context"],
      ["coverage", "Coverage intent"],
      ["requirements", "Linked requirements"],
      ["answers", "Question feedback"],
    ])
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes.push(text);
  } catch {
    changes.push("Scope baseline unavailable");
  }
  return changes;
}
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
    answers: scopeQuestions(item, scenario)
      .filter((value) => value.status === "resolved")
      .map(({ id, text, resolution }) => ({ id, text, resolution })),
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
      !value.replacesCaseId &&
      !value.unknowns.length &&
      !caseContentIssues(value).length &&
      parent?.review === "accepted" &&
      !parent.archived &&
      !caseNeedsReview(item, value)
    );
  });
}
function creationDestinations(parent: Scenario) {
  return { manual: parent.destinations.manual, qase: parent.destinations.qase || parent.destinations.automation, automation: false };
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
    destinations: creationDestinations(parent),
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
export function applyGeneratedCases(
  input: Testpaq,
  scenarioId: string,
  result: CaseGenerationResult,
  runId: string,
  targetCaseId?: string,
): Testpaq {
  const item = structuredClone(input);
  const parent = item.scenarios.find((value) => value.id === scenarioId);
  if (!parent || parent.review !== "accepted" || parent.archived || parent.scopeReviewRequired)
    throw new Error("Coverage must be accepted and current before drafting test cases.");
  const validated = CaseGenerationResultSchema.parse(result);
  const target = targetCaseId
    ? item.testCases?.find(
        (value) => value.id === targetCaseId && value.scenarioId === scenarioId && !value.archived && !value.replacesCaseId,
      )
    : undefined;
  if (targetCaseId && (!target || validated.testCases.length !== 1))
    throw new Error("A case update must contain exactly one revision for an existing case.");
  const timestamp = new Date(Math.max(Date.now(), Date.parse(input.updatedAt) + 1)).toISOString();
  item.testCases ??= [];
  // Identical proposals are skipped. Existing cases, review decisions and human edits are never replaced.
  for (const proposed of validated.testCases) {
    const { clientId: _clientId, ...fields } = proposed;
    const steps = fields.steps.map((value) => ({ ...value, id: crypto.randomUUID() }));
    const candidate = { ...fields, steps };
    if (
      !targetCaseId &&
      item.testCases.some(
        (value) => value.scenarioId === parent.id && testCaseContentSignature(value) === testCaseContentSignature(candidate),
      )
    )
      continue;
    item.testCases.push({
      ...candidate,
      id: crypto.randomUUID(),
      scenarioId: parent.id,
      replacesCaseId: targetCaseId,
      replacesContentSignature: target ? testCaseContentSignature(target) : undefined,
      origin: "generated",
      review: "proposed",
      destinations: { ...(target?.destinations ?? creationDestinations(parent)) },
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

/** Applying a reviewed revision preserves the original identity and destination decisions. */
export function applyCaseRevision(input: Testpaq, proposalId: string): Testpaq {
  const item = structuredClone(input);
  const proposal = item.testCases?.find((value) => value.id === proposalId);
  const target = item.testCases?.find((value) => value.id === proposal?.replacesCaseId);
  if (
    item.status === "completed" ||
    !proposal ||
    !target ||
    proposal.review === "rejected" ||
    proposal.archived ||
    target.archived ||
    target.replacesCaseId ||
    target.scenarioId !== proposal.scenarioId ||
    proposal.replacesContentSignature !== testCaseContentSignature(target) ||
    caseNeedsReview(item, proposal)
  )
    throw new Error("This revision is no longer current. Request a new update.");
  const { title, objective, preconditions, postconditions, steps, unknowns } = proposal;
  Object.assign(target, {
    title,
    objective,
    preconditions,
    postconditions,
    steps,
    unknowns,
    review: "proposed",
    sourceSignature: proposal.sourceSignature,
    lastChangedInRun: proposal.introducedInRun,
    editedByHumanAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  item.testCases = item.testCases!.filter((value) => value.id !== proposalId);
  return item;
}

/** Starter text is a drafting aid, not reviewed executable detail. */
export function caseAuthoringIssues(value: TestCase): string[] {
  return caseContentIssues(value);
}
