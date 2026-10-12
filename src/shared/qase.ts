import { eligibleCases } from "./test-cases.js";
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

export function qaseCases(item: Testpaq) {
  return eligibleCases(item).filter((value) => value.destinations.qase || value.destinations.automation);
}

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
// Qase v2 uses a second quoting layer inside the CSV cell for each step.
const steps = (values: string[]) => values.map((value, index) => `${index + 1}. ${quote(value)}`).join("\n");

export function renderQaseCsv(item: Testpaq): string {
  const rows = qaseCases(item).map((testCase) => {
    const scenario = item.scenarios.find((value) => value.id === testCase.scenarioId)!;
    const requirements = scenario.requirementIds
      .map((id) => item.requirements.find((requirement) => requirement.id === id))
      .filter((requirement) => requirement !== undefined)
      .map((requirement) => `- ${requirement.text}`);
    const description = [
      `Testpaq: ${item.title}`,
      item.ticket.reference ? `Ticket: ${item.ticket.reference}` : "",
      `Coverage output: ${scenario.title}`,
      `Scenario ID: ${scenario.id}`,
      `Test case ID: ${testCase.id}`,
      `Test objective: ${testCase.objective}`,
      `Case origin: ${testCase.origin}`,
      `Origin: ${scenario.origin}`,
      `Category: ${scenario.category}`,
      requirements.length ? `Requirements:\n${requirements.join("\n")}` : "",
      scenario.rationale ? `Rationale: ${scenario.rationale}` : "",
      scenario.risks.length ? `Risks:\n${scenario.risks.map((risk) => `- ${risk}`).join("\n")}` : "",
      testCase.destinations.automation ? "Automation planned; implementation is outside v0.3" : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const fields: Partial<Record<(typeof QASE_HEADERS)[number], string>> = {
      title: testCase.title,
      preconditions: testCase.preconditions,
      postconditions: testCase.postconditions,
      description,
      automation: testCase.destinations.automation ? "to-be-automated" : "is-not-automated",
      status: "actual",
      steps_type: "classic",
      steps_actions: steps(testCase.steps.map((value) => value.action)),
      steps_result: steps(testCase.steps.map((value) => value.expectedResult)),
      steps_data: steps(testCase.steps.map((value) => value.data)),
    };
    return QASE_HEADERS.map((header) => quote(fields[header] ?? "")).join(",");
  });
  return `${QASE_HEADERS.join(",")}\r\n${rows.length ? `${rows.join("\r\n")}\r\n` : ""}`;
}
