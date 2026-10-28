// @vitest-environment node
import { expect, it } from "vitest";
import { TestpaqStore } from "./store";
import { makeFixture, reviewedFixtureCase } from "./fixture";
import { caseNeedsReview, caseScopeChanges, scopeQuestions } from "../src/shared/test-cases";

// The signature exactly as earlier versions stored it: the full scope JSON, repeated on every case.
const legacySignature = (item: ReturnType<typeof makeFixture>, scenario: ReturnType<typeof makeFixture>["scenarios"][number]) =>
  JSON.stringify({
    ticket: item.ticket,
    coverage: {
      title: scenario.title,
      expectedOutcome: scenario.expectedOutcome,
      category: scenario.category,
      rationale: scenario.rationale,
      risks: scenario.risks,
    },
    requirements: scenario.requirementIds.map((id) => item.requirements.find((value) => value.id === id)),
    answers: scopeQuestions(item, scenario)
      .filter((value) => value.status === "resolved")
      .map(({ id, text, resolution }) => ({ id, text, resolution })),
  });

it("keeps existing cases current, and still explains a later ticket change, when a stored row holds an old full-JSON signature", () => {
  const store = new TestpaqStore(":memory:");
  try {
    const item = makeFixture();
    item.testCases = [{ ...reviewedFixtureCase(item, item.scenarios[0]), review: "accepted" }];
    store.save(item);
    // Rewrite the row as an older release would have written it.
    const row = JSON.parse(
      (store.database.prepare("SELECT payload FROM testpaqs WHERE id = ?").get(item.id) as { payload: string }).payload,
    );
    row.testCases[0].sourceSignature = legacySignature(item, item.scenarios[0]);
    store.database.prepare("UPDATE testpaqs SET payload = ? WHERE id = ?").run(JSON.stringify(row), item.id);

    const loaded = store.get(item.id)!;
    expect(loaded.testCases![0].sourceSignature.length).toBeLessThan(500);
    expect(caseNeedsReview(loaded, loaded.testCases![0])).toBe(false);

    const edited = { ...loaded, ticket: { ...loaded.ticket, description: `${loaded.ticket.description} Changed.` } };
    expect(caseNeedsReview(edited, edited.testCases![0])).toBe(true);
    const changes = caseScopeChanges(edited, edited.testCases![0]);
    expect(changes).toContain("Ticket context");
    expect(changes).not.toContain("Scope baseline unavailable");
  } finally {
    store.close();
  }
});
