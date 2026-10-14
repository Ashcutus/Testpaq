import type { Testpaq } from "./domain.js";
import { caseNeedsReview, eligibleCases } from "./test-cases.js";

export function workflowSummary(item: Testpaq) {
  const coverage = item.scenarios.filter((value) => value.review === "accepted" && !value.archived);
  const cases = (item.testCases ?? []).filter((value) => !value.archived && !value.replacesCaseId);
  const ready = eligibleCases(item);
  const covered = new Set(coverage.filter((value) => !value.scopeReviewRequired).flatMap((value) => value.requirementIds));
  return {
    uncovered: item.requirements.filter((value) => value.active && !covered.has(value.id)),
    needsCases: coverage.filter((value) => !cases.some((entry) => entry.scenarioId === value.id && entry.review !== "rejected")),
    scopeReview: cases.filter((value) => value.review !== "rejected" && caseNeedsReview(item, value)),
    proposed: (item.testCases ?? []).filter((value) => !value.archived && value.review === "proposed"),
    manual: ready.filter((value) => value.destinations.manual),
    qase: ready.filter((value) => value.destinations.qase || value.destinations.automation),
    openQuestions: item.questions.filter((value) => value.status === "open"),
  };
}
