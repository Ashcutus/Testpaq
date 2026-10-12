import { testCaseContentSignature } from "../shared/test-cases";
import { TestpaqSchema, type Testpaq } from "../shared/domain";

export type LocalDraft = { base: Testpaq; draft: Testpaq };
export const draftKey = (id: string) => `testpaq-draft:${id}`;
export function writeDraft(base: Testpaq, draft: Testpaq) {
  localStorage.setItem(draftKey(draft.id), JSON.stringify({ base, draft }));
}
export function clearDraft(id: string) {
  localStorage.removeItem(draftKey(id));
}
export function readDraft(id: string): LocalDraft | undefined {
  try {
    const saved = localStorage.getItem(draftKey(id));
    if (!saved) return;
    const envelope = JSON.parse(saved) as LocalDraft;
    TestpaqSchema.parse(envelope.base);
    const draft = envelope.draft;
    // Empty edits are valid drafts, though they are not valid persisted aggregates.
    TestpaqSchema.parse({
      ...draft,
      title: draft.title.trim() || "Untitled",
      requirements: draft.requirements.map((value) => ({ ...value, text: value.text.trim() || "Untitled requirement" })),
      scenarios: draft.scenarios.map((value) => ({
        ...value,
        title: value.title.trim() || "Untitled scenario",
        expectedOutcome: value.expectedOutcome.trim() || "Expected outcome",
      })),
      testCases: draft.testCases?.map((value) => ({
        ...value,
        title: value.title.trim() || "Untitled test case",
        objective: value.objective.trim() || "Test objective",
        steps: value.steps.map((step) => ({
          ...step,
          action: step.action.trim() || "Action",
          expectedResult: step.expectedResult.trim() || "Expected result",
        })),
      })),
      questions: draft.questions.map((value) => ({ ...value, text: value.text.trim() || "Untitled question" })),
    });
    if (draft.id !== id || envelope.base.id !== id) return;
    return envelope;
  } catch {
    return;
  }
}

/** Compare by stable IDs, merging independent edits and recording contested fields. */
export function mergeDraft(base: Testpaq, local: Testpaq, remote: Testpaq): { item: Testpaq; conflicts: string[] } {
  const conflicts: string[] = [];
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const merge = (before: unknown, ours: unknown, theirs: unknown, path: string): unknown => {
    if (path === "testCases") {
      before ??= [];
      ours ??= [];
      theirs ??= [];
    }
    if (equal(ours, before)) return theirs;
    if (equal(theirs, before) || equal(ours, theirs)) return ours;
    if (
      Array.isArray(before) &&
      Array.isArray(ours) &&
      Array.isArray(theirs) &&
      [...before, ...ours, ...theirs].every((value) => value && typeof value === "object" && "id" in value)
    ) {
      const ids = [...new Set([...theirs, ...ours].map((value) => value.id as string))];
      return ids
        .map((id) =>
          merge(
            before.find((value) => value.id === id),
            ours.find((value) => value.id === id),
            theirs.find((value) => value.id === id),
            `${path}.${id}`,
          ),
        )
        .filter((value) => value !== undefined);
    }
    if (
      before &&
      ours &&
      theirs &&
      typeof before === "object" &&
      typeof ours === "object" &&
      typeof theirs === "object" &&
      !Array.isArray(ours) &&
      !Array.isArray(theirs)
    ) {
      const objects = [before, ours, theirs] as Record<string, unknown>[];
      return Object.fromEntries(
        [...new Set(objects.flatMap(Object.keys))].map((key) => [
          key,
          merge(objects[0][key], objects[1][key], objects[2][key], path ? `${path}.${key}` : key),
        ]),
      );
    }
    // Explicitly presented to the user; nothing is saved by this function.
    conflicts.push(path);
    return ours;
  };
  const item = merge(base, local, remote, "") as Testpaq;
  for (const value of item.testCases ?? []) {
    const saved = remote.testCases?.find((candidate) => candidate.id === value.id);
    if (saved && value.review === "accepted" && testCaseContentSignature(saved) !== testCaseContentSignature(value))
      value.review = "proposed";
  }
  item.updatedAt = remote.updatedAt;
  item.createdAt = remote.createdAt;
  return { item, conflicts: conflicts.filter((path) => path !== "updatedAt") };
}
