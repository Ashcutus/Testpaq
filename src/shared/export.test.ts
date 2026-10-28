import { describe, expect, it } from "vitest";
import { makeFixture } from "../../server/fixture";
import { renderManualCases, renderMarkdown } from "./export";
import { newTestCase } from "./test-cases";

describe("Markdown export", () => {
  it("is deterministic and labels intentions accurately", () => {
    const fixture = makeFixture();
    const first = renderMarkdown(fixture);
    const second = renderMarkdown(fixture);
    expect(first).toBe(second);
    expect(first).toContain("Qase CSV");
    expect(first).toContain("To be automated in Qase");
    expect(first).not.toContain("exists in Qase");
    expect(first).toContain("## Uncovered requirements");
    expect(first).toContain("A help article must explain");
    expect(first).toContain("## Open questions");
  });

  it("uses active requirement numbering consistently in scenario links", () => {
    const fixture = makeFixture();
    fixture.requirements[0].active = false;
    const second = fixture.requirements[1];
    const accepted = fixture.scenarios.find((scenario) => scenario.review === "accepted")!;
    accepted.requirementIds = [second.id];
    expect(renderMarkdown(fixture)).toContain("- **Requirements:** 2");
  });

  it("renders cases with only a title, description, preconditions and steps", () => {
    const fixture = makeFixture();
    const testCase = newTestCase(fixture, fixture.scenarios[0]);
    Object.assign(testCase, {
      title: "Owner hides amount",
      objective: "Verify the owner can hide the amount",
      preconditions: "Owner is signed in",
      postconditions: "Restore the amount",
      unknowns: [],
      review: "accepted",
      origin: "generated",
    });
    testCase.steps = [{ id: crypto.randomUUID(), action: "Choose Hide amount", data: "", expectedResult: "The amount is hidden" }];
    const text = renderManualCases([testCase]);
    expect(text).toBe(
      "## Owner hides amount\n\nVerify the owner can hide the amount\n\n**Preconditions:** Owner is signed in\n\n1. Choose Hide amount\n   - Expected: The amount is hidden\n",
    );
    for (const leaked of [testCase.id, "Restore the amount", "generated", "Review", "Qase"]) expect(text).not.toContain(leaked);
  });
});
