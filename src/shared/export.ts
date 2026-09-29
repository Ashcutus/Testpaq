import type { Testpaq } from "./domain.js";

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const safe = (value: string) => value.replaceAll("\r", "").trim();

export function renderMarkdown(testpaq: Testpaq, includeRejected = false): string {
  const accepted = testpaq.scenarios.filter((scenario) => scenario.review === "accepted");
  const rejected = testpaq.scenarios.filter((scenario) => scenario.review === "rejected");
  const covered = new Set(accepted.flatMap((scenario) => scenario.requirementIds));
  const uncovered = testpaq.requirements.filter((requirement) => requirement.active && !covered.has(requirement.id));
  const openQuestions = testpaq.questions.filter((question) => question.status === "open");
  const risks = [...new Set(accepted.flatMap((scenario) => scenario.risks))];
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
      .flatMap((requirement, index) => [`${index + 1}. ${safe(requirement.text)} _(${label(requirement.source)})_`]),
    "",
    "## Accepted scenarios",
    "",
    ...(accepted.length
      ? accepted.flatMap((scenario, index) => {
          const requirementNumbers = scenario.requirementIds
            .map((id) => testpaq.requirements.findIndex((requirement) => requirement.id === id) + 1)
            .filter(Boolean);
          const destinations = Object.entries(scenario.destinations)
            .filter(([, active]) => active)
            .map(([name]) => (name === "qase" ? "Qase candidate" : name === "automation" ? "Automation candidate" : "Manual"));
          return [
            `### ${index + 1}. ${safe(scenario.title)}`,
            "",
            `- **Origin:** ${label(scenario.origin)}`,
            `- **Category:** ${label(scenario.category)}`,
            `- **Requirements:** ${requirementNumbers.length ? requirementNumbers.join(", ") : "None (additional coverage)"}`,
            `- **Intended coverage:** ${destinations.length ? destinations.join(", ") : "Unclassified"}`,
            "",
            safe(scenario.expectedOutcome),
            ...(scenario.rationale ? ["", `> Rationale: ${safe(scenario.rationale)}`] : []),
            "",
          ];
        })
      : ["No scenarios have been accepted.", ""]),
    "## Uncovered requirements",
    "",
    ...(uncovered.length ? uncovered.map((requirement) => `- ${safe(requirement.text)}`) : ["None."]),
    "",
    "## Open questions",
    "",
    ...(openQuestions.length ? openQuestions.map((question) => `- ${safe(question.text)} _(${label(question.origin)})_`) : ["None."]),
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
