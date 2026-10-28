import { eligibleCases } from "./test-cases.js";
import type { Testpaq } from "./domain.js";

// Qase's legacy (V1) CSV: first column `id`, imported with the "Qase.io CSV [deprecated]" source, with steps as plain
// numbered lines. V2 (`v2.id`) instead requires every step quoted inside its cell, so the two must never be mixed.
// Only columns Qase documents for test cases are written; blank IDs create new cases on import.
export const QASE_HEADERS = [
  "id",
  "title",
  "description",
  "preconditions",
  "automation",
  "status",
  "steps_type",
  "steps_actions",
  "steps_results",
  "steps_data",
] as const;

export function qaseCases(item: Testpaq) {
  return eligibleCases(item).filter((value) => value.destinations.qase || value.destinations.automation);
}

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
/**
 * Legacy (V1) steps: one cell per column holding plain numbered lines ("1. Open the page"). This is the only place the
 * step encoding lives. A step with no value is skipped; Qase treats missing numbers as steps without that detail.
 * Line breaks inside a step are flattened because lines delimit steps.
 */
export function plainSteps(values: string[]): string {
  return values
    .map((value, index) => [index + 1, value.replace(/\s*[\r\n]+\s*/g, " ").trim()] as const)
    .filter(([, value]) => value)
    .map(([number, value]) => `${number}. ${value}`)
    .join("\n");
}

/** Only test content is exported: title, description, preconditions and steps. */
export function renderQaseCsv(item: Testpaq): string {
  const rows = qaseCases(item).map((testCase) => {
    const fields: Partial<Record<(typeof QASE_HEADERS)[number], string>> = {
      title: testCase.title,
      description: testCase.objective,
      preconditions: testCase.preconditions,
      automation: testCase.destinations.automation ? "to-be-automated" : "is-not-automated",
      status: "actual",
      steps_type: "classic",
      steps_actions: plainSteps(testCase.steps.map((value) => value.action)),
      steps_results: plainSteps(testCase.steps.map((value) => value.expectedResult)),
      steps_data: plainSteps(testCase.steps.map((value) => value.data)),
    };
    return QASE_HEADERS.map((header) => quote(fields[header] ?? "")).join(",");
  });
  return `${QASE_HEADERS.join(",")}\r\n${rows.length ? `${rows.join("\r\n")}\r\n` : ""}`;
}
