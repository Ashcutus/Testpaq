import { caseContentIssues } from "./authoring.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  CaseBatchResultSchema,
  CaseGenerationResultSchema,
  MAX_TEST_CASES,
  TestCaseSchema,
  TestpaqSchema,
  type CaseBatchResult,
  type CaseApplication,
  type CaseGenerationResult,
  type Scenario,
  type TestCase,
  type Testpaq,
} from "./domain.js";

export function scopeQuestions(item: Pick<Testpaq, "questions">, scenario: Scenario) {
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
    const before = JSON.parse(compactScopeSignature(value.sourceSignature)),
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
/** Hash historical sections, never today's scope: compacting an old baseline must preserve stale-case detection. */
export function compactScopeSignature(signature: string): string {
  try {
    const value = JSON.parse(signature);
    if (!value || typeof value !== "object" || value.version === 1) return signature;
    const keys = ["ticket", "coverage", "requirements", "answers"] as const;
    if (!keys.every((key) => Object.hasOwn(value, key))) return signature;
    return JSON.stringify({
      version: 1,
      ...Object.fromEntries(keys.map((key) => [key, bytesToHex(sha256(utf8ToBytes(JSON.stringify(value[key]))))])),
    });
  } catch {
    return signature;
  }
}

export function compactTestpaqSignatures(item: Testpaq): Testpaq {
  return item.testCases
    ? { ...item, testCases: item.testCases.map((value) => ({ ...value, sourceSignature: compactScopeSignature(value.sourceSignature) })) }
    : item;
}

/** Compact, versioned per-section fingerprints retain scope diagnostics without repeating the ticket for every case. */
export function caseScopeSignature(item: Pick<Testpaq, "ticket" | "requirements" | "questions">, scenario: Scenario): string {
  return compactScopeSignature(
    JSON.stringify({
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
    }),
  );
}
export function caseNeedsReview(item: Pick<Testpaq, "ticket" | "requirements" | "questions" | "scenarios">, value: TestCase): boolean {
  const parent = item.scenarios.find((scenario) => scenario.id === value.scenarioId);
  return (
    !parent || Boolean(parent.scopeReviewRequired) || compactScopeSignature(value.sourceSignature) !== caseScopeSignature(item, parent)
  );
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
  value: Pick<TestCase, "title" | "objective" | "preconditions" | "postconditions" | "unknowns"> & {
    steps: Array<Pick<TestCase["steps"][number], "action" | "data" | "expectedResult">>;
  },
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
  const sourceSignature = caseScopeSignature(item, parent);
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
      sourceSignature,
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

/** A proposal that is still waiting for a decision: not rejected or archived, and neither it nor its original has moved on. */
export function pendingRevision(item: Testpaq, target: TestCase): TestCase | undefined {
  return (item.testCases ?? []).find(
    (value) =>
      value.replacesCaseId === target.id &&
      !value.archived &&
      value.review !== "rejected" &&
      value.replacesContentSignature === testCaseContentSignature(target) &&
      !caseNeedsReview(item, value),
  );
}

const MAX_CASES_PER_APPLICATION = 30;

/**
 * Applies one batched response. New cases and revisions are routed through the single-coverage rules, so accepted,
 * rejected, archived and human-edited cases are never replaced. Entries for unknown coverage or unrequested targets are ignored.
 * Revisions take priority across all selected coverage. Capacity skips are distinct from missing provider output.
 */
export function applyGeneratedBatch(
  input: Testpaq,
  scenarioIds: string[],
  updateCaseIds: string[],
  result: CaseBatchResult,
  runId: string,
): CaseApplication & { item: Testpaq } {
  const validated = CaseBatchResultSchema.parse(result);
  let item = input;
  let added = 0;
  let revised = 0;
  let capacitySkippedNewCases = 0;
  const capacitySkippedUpdateCaseIds: string[] = [];
  const room = () => MAX_TEST_CASES - (item.testCases?.length ?? 0);
  const legacyShape = (value: CaseBatchResult["testCases"][number]) => {
    const { clientId, title, description, preconditions, steps } = value;
    return { clientId, title, objective: description, preconditions, postconditions: "", steps, unknowns: [] };
  };
  const returnedUpdateIds = new Set<string>();
  // Reserve available slots for requested revisions before considering additions from any coverage output.
  for (const revision of validated.testCases.filter((value) => value.replacesCaseId)) {
    const target = item.testCases?.find((value) => value.id === revision.replacesCaseId);
    if (
      !target ||
      target.archived ||
      target.replacesCaseId ||
      target.scenarioId !== revision.scenarioId ||
      !scenarioIds.includes(target.scenarioId) ||
      !updateCaseIds.includes(target.id)
    )
      continue;
    returnedUpdateIds.add(target.id);
    if (pendingRevision(item, target)) continue;
    if (room() < 1) {
      capacitySkippedUpdateCaseIds.push(target.id);
      continue;
    }
    item = applyGeneratedCases(item, target.scenarioId, { testCases: [legacyShape(revision)] }, runId, target.id);
    revised += 1;
  }
  for (const scenarioId of scenarioIds) {
    const signatures = new Set((item.testCases ?? []).filter((value) => value.scenarioId === scenarioId).map(testCaseContentSignature));
    const additions = validated.testCases
      .filter((value) => value.scenarioId === scenarioId && !value.replacesCaseId)
      .map(legacyShape)
      .filter((value) => {
        const signature = testCaseContentSignature(value);
        if (signatures.has(signature)) return false;
        signatures.add(signature);
        return true;
      });
    let consumed = 0;
    while (consumed < additions.length && room() > 0) {
      const group = additions.slice(consumed, consumed + Math.min(MAX_CASES_PER_APPLICATION, room()));
      item = applyGeneratedCases(item, scenarioId, { testCases: group }, runId);
      added += group.length;
      consumed += group.length;
    }
    capacitySkippedNewCases += additions.length - consumed;
  }
  const missingUpdateCaseIds = updateCaseIds.filter((id) => {
    const target = item.testCases?.find((value) => value.id === id);
    return !returnedUpdateIds.has(id) && !(target && pendingRevision(item, target));
  });
  return { item, added, revised, missingUpdateCaseIds, capacitySkippedNewCases, capacitySkippedUpdateCaseIds };
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
