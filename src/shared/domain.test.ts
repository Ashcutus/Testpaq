import { describe, expect, it } from "vitest";
import { AnalysisResultSchema, ScenarioSchema, TestpaqSchema } from "./domain";
import { makeFixture } from "../../server/fixture";

describe("domain invariants", () => {
  it("requires an explicit scenario to link a requirement", () => {
    const fixture = makeFixture();
    expect(() => ScenarioSchema.parse({ ...fixture.scenarios[0], requirementIds: [] })).toThrow(/Explicit scenarios/);
  });

  it("keeps destination flags independent", () => {
    const fixture = makeFixture();
    const scenario = ScenarioSchema.parse({ ...fixture.scenarios[0], destinations: { manual: true, qase: false, automation: true } });
    expect(scenario.destinations).toEqual({ manual: true, qase: false, automation: true });
  });

  it("rejects broken requirement and question links", () => {
    const fixture = makeFixture();
    fixture.questions[0].requirementId = crypto.randomUUID();
    expect(TestpaqSchema.safeParse(fixture).success).toBe(false);
  });

  it("rejects malformed analysis and duplicate IDs", () => {
    const result = {
      requirements: [
        { clientId: "r1", text: "Something works", source: "acceptance_criteria" },
        { clientId: "r1", text: "Duplicate", source: "description" },
      ],
      scenarios: [
        {
          clientId: "s1",
          title: "It works",
          expectedOutcome: "Works",
          origin: "explicit",
          category: "happy_path",
          requirementClientIds: [],
          risks: [],
        },
      ],
      questions: [],
    };
    expect(AnalysisResultSchema.safeParse(result).success).toBe(false);
  });
});
