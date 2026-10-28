import { eligibleCases } from "./test-cases.js";
import type { TestCase, Testpaq } from "./domain.js";

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
    "## Test cases",
    "",
    ...(exportCases.length
      ? exportCases.flatMap((value) => renderCaseMarkdown(value, "###"))
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

/** A case as a tester needs it: title, description, preconditions and steps. Nothing else. */
export function renderCaseMarkdown(value: TestCase, heading: "#" | "##" | "###" = "##"): string[] {
  return [
    `${heading} ${safe(value.title)}`,
    "",
    ...(safe(value.objective) ? [safe(value.objective), ""] : []),
    ...(safe(value.preconditions) ? [`**Preconditions:** ${safe(value.preconditions)}`, ""] : []),
    ...value.steps.flatMap((step, index) => [
      `${index + 1}. ${safe(step.action)}`,
      ...(safe(step.data) ? [`   - Data: ${safe(step.data)}`] : []),
      `   - Expected: ${safe(step.expectedResult)}`,
    ]),
    "",
  ];
}

/** The Manual download: reviewed cases only, with no coverage, requirement or review commentary. */
export function renderManualCases(cases: TestCase[]): string {
  const lines = cases.length ? cases.flatMap((value) => renderCaseMarkdown(value)) : ["No reviewed test cases are ready for handoff.", ""];
  return `${lines.join("\n").trim()}\n`;
}
