import { describe, expect, it } from "vitest";
import { newTestCase } from "./test-cases";
import { makeFixture } from "../../server/fixture";
import { QASE_HEADERS, qaseCases, renderQaseCsv } from "./qase";

// Read RFC 4180 cells independently of the exporter, including embedded newlines.
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && character === "\r" && csv[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index++;
    } else cell += character;
  }
  return rows;
}

describe("Qase native CSV export", () => {
  it("includes only accepted Qase/Cypress selections, deduplicating dual selections", () => {
    const item = makeFixture();
    item.scenarios.forEach((scenario) => {
      scenario.review = "accepted";
      scenario.destinations = { manual: true, qase: false, automation: false };
    });
    item.scenarios[0].destinations.qase = true;
    item.scenarios[1].destinations.automation = true;
    item.scenarios[2].destinations = { manual: false, qase: true, automation: true };
    item.scenarios[3].destinations.qase = true;
    item.scenarios[3].review = "proposed";
    item.scenarios[4].destinations.automation = true;
    item.scenarios[4].review = "rejected";
    item.testCases = item.scenarios
      .slice(0, 5)
      .map((parent) => ({ ...newTestCase(item, parent), title: parent.title, review: "accepted" }));
    const rows = parseCsv(renderQaseCsv(item));
    expect(rows[0]).toEqual(QASE_HEADERS);
    expect(rows).toHaveLength(4);
    const automation = QASE_HEADERS.indexOf("automation");
    expect(rows.slice(1).map((row) => row[automation])).toEqual(["is-not-automated", "to-be-automated", "to-be-automated"]);
    expect(rows.slice(1).every((row) => row[0] === "" && row.length === QASE_HEADERS.length)).toBe(true);
  });
  it("preserves Unicode, quotes, commas and multiline outcomes through both CSV layers", () => {
    const item = makeFixture();
    const scenario = item.scenarios[0];
    item.scenarios = [scenario];
    item.questions = [];
    scenario.review = "accepted";
    scenario.destinations.qase = true;
    scenario.title = 'Check "£5", café';
    scenario.expectedOutcome = 'Shows "£5", correctly\nNo extra charge';
    const testCase = newTestCase(item, scenario);
    testCase.title = scenario.title;
    testCase.review = "accepted";
    testCase.preconditions = "Signed in as campaign owner";
    testCase.steps = [
      { id: crypto.randomUUID(), action: scenario.title, data: 'Amount: "£5"', expectedResult: scenario.expectedOutcome },
      { id: crypto.randomUUID(), action: "Reload the page", data: "", expectedResult: "Preference persists" },
    ];
    item.testCases = [testCase];
    const csv = renderQaseCsv(item);
    const [headers, row] = parseCsv(csv);
    const field = (name: string) => row[headers.indexOf(name)];
    expect(field("title")).toBe(scenario.title);
    expect(field("steps_actions")).toBe('1. "Check ""£5"", café"\n2. "Reload the page"');
    expect(field("steps_result")).toBe('1. "Shows ""£5"", correctly\nNo extra charge"\n2. "Preference persists"');
    expect(field("steps_data")).toBe('1. "Amount: ""£5"""\n2. ""');
    expect(field("preconditions")).toBe(testCase.preconditions);
    expect(field("description")).toContain(testCase.id);
    expect(field("description")).toContain(item.requirements[0].text);
    expect(renderQaseCsv(item)).toBe(csv);
  });
  it("exports only the template when nothing is selected without mutating state", () => {
    const item = makeFixture();
    item.scenarios = [];
    const before = structuredClone(item);
    expect(qaseCases(item)).toEqual([]);
    expect(renderQaseCsv(item)).toBe(`${QASE_HEADERS.join(",")}\r\n`);
    expect(item).toEqual(before);
  });
});
