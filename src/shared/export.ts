import { eligibleCases, caseNeedsReview } from "./test-cases.js";
import type { Testpaq } from "./domain.js";

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const safe = (value: string) => value.replaceAll("\r", "").trim();

export function renderMarkdown(testpaq: Testpaq, includeRejected = false): string {
  const requirementNumbers = activeRequirementNumbers(testpaq);
  const accepted = testpaq.scenarios.filter((scenario) => scenario.review === "accepted" && !scenario.archived);
  const rejected = testpaq.scenarios.filter((scenario) => scenario.review === "rejected");
  const covered = new Set(accepted.flatMap((scenario) => scenario.requirementIds));
  const uncovered = testpaq.requirements.filter((requirement) => requirement.active && !covered.has(requirement.id));
  const openQuestions = testpaq.questions.filter((question) => question.status === "open");
  const answeredQuestions = testpaq.questions.filter((question) => question.status === "resolved" && question.resolution?.trim());
  const risks = [...new Set(accepted.flatMap((scenario) => scenario.risks))];
  const exportCases = eligibleCases(testpaq);
  const ready = new Set(exportCases.map((value) => value.id));
  const lines = [
    `# QA coverage: ${safe(testpaq.title)}`,
    "",
    testpaq.ticket.reference ? `**Ticket:** ${safe(testpaq.ticket.reference)}` : "",
    `**Status:** ${label(testpaq.status)}`,
    `**Updated:** ${testpaq.updatedAt.slice(0, 10)}`,
    "",
    "## Context",
    "",
    safe(testpaq.ticket.description) || "No description supplied.",
    "",
    "## Requirements",
    "",
    ...testpaq.requirements
      .filter((requirement) => requirement.active)
      .flatMap((requirement) => [`${requirementNumbers.get(requirement.id)}. ${safe(requirement.text)} _(${label(requirement.source)})_`]),
    "",
    "## Accepted scenarios",
    "",
    ...(accepted.length
      ? accepted.flatMap((scenario, index) => {
          const linkedRequirementNumbers = scenario.requirementIds
            .map((id) => requirementNumbers.get(id))
            .filter((value): value is number => value !== undefined);
          const destinations = Object.entries(scenario.destinations)
            .filter(([, active]) => active)
            .map(([name]) => (name === "qase" ? "Qase CSV" : name === "automation" ? "To be automated in Qase" : "Manual"));
          return [
            `### ${index + 1}. ${safe(scenario.title)}`,
            "",
            `- **Origin:** ${label(scenario.origin)}`,
            `- **Category:** ${label(scenario.category)}`,
            `- **Requirements:** ${linkedRequirementNumbers.length ? linkedRequirementNumbers.join(", ") : "None (additional coverage)"}`,
            `- **Intended coverage:** ${destinations.length ? destinations.join(", ") : "Unclassified"}`,
            "",
            safe(scenario.expectedOutcome),
            ...(scenario.rationale ? ["", `> Rationale: ${safe(scenario.rationale)}`] : []),
            "",
          ];
        })
      : ["No scenarios have been accepted.", ""]),
    "## Linked test cases",
    "",
    ...(exportCases.length
      ? exportCases.flatMap((value) => [
          `### ${safe(value.title)}`,
          "",
          `- **Case ID:** ${value.id}`,
          `- **Coverage output:** ${safe(testpaq.scenarios.find((scenario) => scenario.id === value.scenarioId)?.title ?? "Unknown")}`,
          `- **Review:** ${label(value.review)}${caseNeedsReview(testpaq, value) ? " (scope review needed)" : ""}`,
          `- **Handoff:** ${ready.has(value.id) ? "Reviewed and current" : "Not ready"}`,
          `- **Destinations:** ${value.destinations.qase ? "Qase CSV" : ""}${value.destinations.automation ? " · To be automated" : ""}${value.destinations.manual ? " · Manual" : ""}`,
          `- **Objective:** ${safe(value.objective)}`,
          `- **Preconditions:** ${safe(value.preconditions) || "None specified"}`,
          `- **Postconditions:** ${safe(value.postconditions) || "None specified"}`,
          ...value.unknowns.map((unknown) => `- **Missing detail:** ${safe(unknown)}`),
          "",
          ...value.steps.flatMap((step, index) => [
            `${index + 1}. ${safe(step.action)}`,
            `   - Data: ${safe(step.data) || "None specified"}`,
            `   - Expected: ${safe(step.expectedResult)}`,
          ]),
          "",
        ])
      : ["No current, accepted test cases are ready for handoff. Accepted scenarios describe coverage intent.", ""]),
    "## Uncovered requirements",
    "",
    ...(uncovered.length ? uncovered.map((requirement) => `- ${safe(requirement.text)}`) : ["None."]),
    "",
    "## Open questions",
    "",
    ...(openQuestions.length ? openQuestions.map((question) => `- ${safe(question.text)} _(${label(question.origin)})_`) : ["None."]),
    "",
    "## Answered questions",
    "",
    ...(answeredQuestions.length
      ? answeredQuestions.flatMap((question) => [`- **Question:** ${safe(question.text)}`, `  **Answer:** ${safe(question.resolution!)}`])
      : ["None."]),
    "",
    "## Risks",
    "",
    ...(risks.length ? risks.map((risk) => `- ${safe(risk)}`) : ["None recorded."]),
  ];
  if (includeRejected && rejected.length) {
    lines.push("", "## Rejected scenarios", "", ...rejected.map((scenario) => `- ${safe(scenario.title)} _(${label(scenario.origin)})_`));
  }
  return `${lines
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n")
    .trim()}\n`;
}

export function activeRequirementNumbers(testpaq: Testpaq): Map<string, number> {
  return new Map(
    testpaq.requirements
      .map((requirement, index) => [requirement, index + 1] as const)
      .filter(([requirement]) => requirement.active)
      .map(([requirement, number]) => [requirement.id, number]),
  );
}
