import type { Testpaq } from "./domain.js";
import { caseNeedsReview, eligibleCases, pendingRevision } from "./test-cases.js";

export function coverageNeedingCases(item: Testpaq) {
  return item.scenarios.filter(
    (scenario) =>
      scenario.review === "accepted" &&
      !scenario.archived &&
      !(item.testCases ?? []).some(
        (value) => value.scenarioId === scenario.id && !value.archived && !value.replacesCaseId && value.review !== "rejected",
      ),
  );
}

export function workflowSummary(item: Testpaq) {
  const coverage = item.scenarios.filter((value) => value.review === "accepted" && !value.archived);
  const cases = (item.testCases ?? []).filter((value) => !value.archived && !value.replacesCaseId);
  const ready = eligibleCases(item);
  const covered = new Set(coverage.filter((value) => !value.scopeReviewRequired).flatMap((value) => value.requirementIds));
  return {
    uncovered: item.requirements.filter((value) => value.active && !covered.has(value.id)),
    needsCases: coverageNeedingCases(item),
    scopeReview: cases.filter((value) => value.review !== "rejected" && caseNeedsReview(item, value)),
    proposed: (item.testCases ?? []).filter((value) => !value.archived && value.review === "proposed"),
    manual: ready.filter((value) => value.destinations.manual),
    qase: ready.filter((value) => value.destinations.qase || value.destinations.automation),
    openQuestions: item.questions.filter((value) => value.status === "open"),
  };
}

/** Accepted, current coverage can receive AI-drafted cases. */
export function draftableCoverage(item: Testpaq) {
  return item.scenarios.filter((value) => value.review === "accepted" && !value.archived && !value.scopeReviewRequired);
}
/** Cases whose scope changed and that have no live proposed revision waiting. */
export function updatableCases(item: Testpaq) {
  const cases = item.testCases ?? [];
  return cases.filter(
    (value) =>
      !value.archived &&
      !value.replacesCaseId &&
      value.review !== "rejected" &&
      caseNeedsReview(item, value) &&
      !pendingRevision(item, value) &&
      draftableCoverage(item).some((scenario) => scenario.id === value.scenarioId),
  );
}
