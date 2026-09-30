// @vitest-environment node
import { describe, expect, it } from "vitest";
import { makeFixture } from "../../server/fixture";
import { applyAnalysis, analysisSignature } from "./analysis";
import type { AnalysisResult } from "./domain";

function result(): AnalysisResult {
  const item = makeFixture();
  return {
    requirements: item.requirements.map((requirement) => ({
      clientId: requirement.id,
      text: requirement.text,
      source: requirement.source,
    })),
    scenarios: item.scenarios
      .filter((scenario) => scenario.origin !== "human")
      .map((scenario) => ({
        clientId: scenario.id,
        title: scenario.title,
        expectedOutcome: "Refreshed expectation",
        origin: scenario.origin as "explicit" | "inferred",
        category: scenario.category,
        requirementClientIds: scenario.requirementIds,
        risks: scenario.risks,
        rationale: scenario.rationale,
      })),
    questions: [],
  };
}

describe("analysis refresh", () => {
  it("preserves reviewed and human edited scenarios and answers while updating proposals without duplicates", () => {
    const item = makeFixture();
    const generated = result();
    // Fixture IDs differ between calls; use matching titles and text for deduplication.
    const proposal = item.scenarios.find((scenario) => scenario.review === "proposed" && scenario.origin !== "human")!;
    const edited = item.scenarios.filter((scenario) => scenario.review === "proposed" && scenario.origin !== "human")[1];
    edited.editedByHumanAt = new Date().toISOString();
    const refreshed = applyAnalysis(item, generated);
    expect(refreshed.scenarios).toHaveLength(item.scenarios.length);
    expect(refreshed.scenarios.find((scenario) => scenario.id === proposal.id)?.expectedOutcome).toBe("Refreshed expectation");
    for (const existing of item.scenarios.filter(
      (scenario) => scenario.review !== "proposed" || scenario.editedByHumanAt || scenario.origin === "human",
    )) {
      expect(refreshed.scenarios.find((scenario) => scenario.id === existing.id)).toEqual(existing);
    }
    expect(refreshed.questions).toEqual(item.questions);
    expect(refreshed.lastAnalysedSignature).toBe(analysisSignature(refreshed));
    expect(applyAnalysis(refreshed, generated).scenarios).toHaveLength(item.scenarios.length);
  });
  it("preserves answers and suppressed requirements, and adds changed scope without rewriting old requirements", () => {
    const item = makeFixture();
    item.requirements[0].active = false;
    const generated: AnalysisResult = {
      requirements: [{ clientId: item.requirements[0].id, text: item.requirements[0].text, source: item.requirements[0].source }],
      scenarios: [],
      questions: [{ text: item.questions[2].text, origin: "explicit", requirementClientId: undefined, scenarioClientId: undefined }],
    };
    const refreshed = applyAnalysis(item, generated);
    expect(refreshed.requirements[0].active).toBe(false);
    expect(refreshed.questions).toEqual(item.questions);
    generated.requirements[0].text = "Newly expanded scope";
    const expanded = applyAnalysis(refreshed, generated);
    expect(expanded.requirements).toHaveLength(item.requirements.length + 1);
    expect(expanded.requirements[0]).toEqual(item.requirements[0]);
  });
  it("marks analysis stale when answers or ticket scope change", () => {
    const item = applyAnalysis(makeFixture(), { requirements: [], scenarios: [], questions: [] });
    item.ticket.description += "Additional scope";
    expect(item.lastAnalysedSignature).not.toBe(analysisSignature(item));
  });
});
