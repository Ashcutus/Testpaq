import { describe, expect, it } from "vitest";
import { makeFixture } from "../../server/fixture";
import { renderMarkdown } from "./export";

describe("Markdown export", () => {
  it("is deterministic and labels intentions accurately", () => {
    const fixture = makeFixture();
    const first = renderMarkdown(fixture);
    const second = renderMarkdown(fixture);
    expect(first).toBe(second);
    expect(first).toContain("Qase candidate");
    expect(first).toContain("Automation candidate");
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
    expect(renderMarkdown(fixture)).toContain("- **Requirements:** 1");
  });
});
