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
});
