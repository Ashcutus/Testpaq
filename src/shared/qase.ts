import type { Testpaq } from "./domain.js";

// Qase's native CSV v2 template. Blank case IDs create new cases on import.
export const QASE_HEADERS = [
  "v2.id",
  "title",
  "description",
  "preconditions",
  "postconditions",
  "tags",
  "priority",
  "severity",
  "type",
  "behavior",
  "automation",
  "status",
  "is_flaky",
  "layer",
  "steps_type",
  "steps_actions",
  "steps_result",
  "steps_data",
  "milestone_id",
  "milestone",
  "suite_id",
  "suite_parent_id",
  "suite",
  "suite_without_cases",
  "parameters",
  "is_muted",
] as const;

export function qaseScenarios(item: Testpaq) {
  return item.scenarios.filter(
    (scenario) => scenario.review === "accepted" && !scenario.archived && (scenario.destinations.qase || scenario.destinations.automation),
  );
}

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
// Qase v2 uses a second quoting layer inside the CSV cell for each step.
const step = (value: string) => `1. ${quote(value)}`;

export function renderQaseCsv(item: Testpaq): string {
  const rows = qaseScenarios(item).map((scenario) => {
    const requirements = scenario.requirementIds
      .map((id) => item.requirements.find((requirement) => requirement.id === id))
      .filter((requirement) => requirement !== undefined)
      .map((requirement) => `- ${requirement.text}`);
    const description = [
      `Testpaq: ${item.title}`,
      item.ticket.reference ? `Ticket: ${item.ticket.reference}` : "",
      `Scenario ID: ${scenario.id}`,
      `Origin: ${scenario.origin}`,
      `Category: ${scenario.category}`,
      requirements.length ? `Requirements:\n${requirements.join("\n")}` : "",
      scenario.rationale ? `Rationale: ${scenario.rationale}` : "",
      scenario.risks.length ? `Risks:\n${scenario.risks.map((risk) => `- ${risk}`).join("\n")}` : "",
      scenario.destinations.automation ? "Automation target: Cypress" : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const fields: Partial<Record<(typeof QASE_HEADERS)[number], string>> = {
      title: scenario.title,
      description,
      automation: scenario.destinations.automation ? "to-be-automated" : "is-not-automated",
      status: "actual",
      steps_type: "classic",
      steps_actions: step(scenario.title),
      steps_result: step(scenario.expectedOutcome),
    };
    return QASE_HEADERS.map((header) => quote(fields[header] ?? "")).join(",");
  });
  return `${QASE_HEADERS.join(",")}\r\n${rows.length ? `${rows.join("\r\n")}\r\n` : ""}`;
}
