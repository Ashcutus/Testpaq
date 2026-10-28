import { describe, expect, it } from "vitest";
import { newTestCase } from "./test-cases";
import { makeFixture, reviewedFixtureCase } from "../../server/fixture";
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

describe("Qase CSV export", () => {
  it("includes only accepted Qase and historical automation selections, deduplicating dual selections", () => {
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
    item.testCases = item.scenarios.slice(0, 5).map((parent) => ({
      ...reviewedFixtureCase(item, parent),
      title: parent.title,
      destinations: { ...parent.destinations },
      review: "accepted",
    }));
    const rows = parseCsv(renderQaseCsv(item));
    expect(rows[0]).toEqual(QASE_HEADERS);
    // Legacy header: never the V2 `v2.id` first column, which would require per-step quoting.
    expect(rows[0][0]).toBe("id");
    expect(rows).toHaveLength(4);
    const automation = QASE_HEADERS.indexOf("automation");
    expect(rows.slice(1).map((row) => row[automation])).toEqual(["is-not-automated", "to-be-automated", "to-be-automated"]);
    expect(rows.slice(1).every((row) => row[0] === "" && row.length === QASE_HEADERS.length)).toBe(true);
  });
  it("exports only test content as plain numbered legacy-style steps", () => {
    const item = makeFixture();
    const scenario = item.scenarios[0];
    item.scenarios = [scenario];
    item.questions = [];
    scenario.review = "accepted";
    scenario.destinations.qase = true;
    scenario.rationale = "Because it matters";
    scenario.risks = ["A risk"];
    const testCase = newTestCase(item, scenario);
    testCase.title = 'Check "£5", café';
    testCase.objective = "Verify the amount shows correctly";
    testCase.review = "accepted";
    testCase.preconditions = "Signed in as campaign owner";
    testCase.postconditions = "Restore the amount";
    testCase.steps = [
      { id: crypto.randomUUID(), action: "Open the page", data: 'Amount: "£5"', expectedResult: "Shows\nthe amount" },
      { id: crypto.randomUUID(), action: "Reload the page", data: "", expectedResult: "Preference persists" },
    ];
    item.testCases = [testCase];
    const csv = renderQaseCsv(item);
    const [headers, row] = parseCsv(csv);
    const field = (name: string) => row[headers.indexOf(name)];
    expect(field("title")).toBe('Check "£5", café');
    expect(field("description")).toBe("Verify the amount shows correctly");
    expect(field("preconditions")).toBe("Signed in as campaign owner");
    expect(headers).not.toContain("postconditions");
    expect(field("steps_actions")).toBe("1. Open the page\n2. Reload the page");
    expect(field("steps_results")).toBe("1. Shows the amount\n2. Preference persists");
    expect(field("steps_data")).toBe('1. Amount: "£5"');
    for (const leaked of [testCase.id, scenario.id, item.title, scenario.rationale, "A risk", item.requirements[0].text])
      expect(csv).not.toContain(leaked);
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
