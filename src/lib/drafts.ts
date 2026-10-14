import { workspaceGeneration, sessionDraftCopies } from "./workspace";
import { testCaseContentSignature } from "../shared/test-cases";
import { TestpaqSchema, type Testpaq } from "../shared/domain";

export type LocalDraft = { base: Testpaq; draft: Testpaq };
export const draftKey = (id: string) => `testpaq-draft:${workspaceGeneration() ?? "legacy"}:${id}`;
export function writeDraft(base: Testpaq, draft: Testpaq) {
  localStorage.setItem(draftKey(draft.id), JSON.stringify({ base, draft, workspaceGeneration: workspaceGeneration() }));
}
export function clearDraft(id: string) {
  localStorage.removeItem(draftKey(id));
}
export function readDraft(id: string, serverVersion?: string): LocalDraft | undefined {
  try {
    const scoped = localStorage.getItem(draftKey(id));
    const saved = scoped ?? localStorage.getItem(`testpaq-draft:${id}`);
    if (!saved) return;
    const envelope = JSON.parse(saved) as LocalDraft;
    TestpaqSchema.parse(envelope.base);
    if (!scoped && serverVersion && envelope.base.updatedAt !== serverVersion) return;
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
export function mergeDraft(
  base: Testpaq,
  local: Testpaq,
  remote: Testpaq,
  choices: Record<string, "local" | "saved"> = {},
): { item: Testpaq; conflicts: string[] } {
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
    if (path === "updatedAt" || /\.(updatedAt|sourceSignature|editedByHumanAt)$/.test(path)) return theirs;
    conflicts.push(path);
    return choices[path] === "saved" ? theirs : ours;
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

export function retainedDrafts() {
  try {
    return [
      ...sessionDraftCopies(),
      ...Object.keys(localStorage)
        .filter((key) => key.startsWith("testpaq-draft:") || key.startsWith("testpaq-recovery:"))
        .flatMap((key) => {
          try {
            return [{ key, ...JSON.parse(localStorage.getItem(key)!) }];
          } catch {
            return [];
          }
        }),
    ];
  } catch {
    return sessionDraftCopies();
  }
}
export function archiveLegacyDrafts() {
  try {
    for (const key of Object.keys(localStorage))
      if (/^testpaq-draft:[^:]+$/.test(key)) {
        localStorage.setItem(`testpaq-recovery:${Date.now()}:${key}`, localStorage.getItem(key)!);
        localStorage.removeItem(key);
      }
  } catch {
    /* Existing copies are left intact on storage failure. */
  }
}

export function draftValue(item: Testpaq, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        Array.isArray(value)
          ? value.find((entry) => entry?.id === key)
          : value && typeof value === "object"
            ? (value as Record<string, unknown>)[key]
            : undefined,
      item,
    );
}
export function draftFieldLabel(item: Testpaq, path: string): string {
  const labels: Record<string, string> = {
    ticket: "Ticket",
    testCases: "Test cases",
    scenarios: "Coverage",
    requirements: "Requirements",
    questions: "Questions",
    expectedOutcome: "Expected behaviour",
    expectedResult: "Expected result",
    requirementIds: "Linked requirements",
    resolution: "Answer",
    sourceSignature: "Reviewed scope",
    steps: "Steps",
  };
  const parts: string[] = [];
  let current: unknown = item;
  for (const key of path.split(".")) {
    if (Array.isArray(current)) {
      const index = current.findIndex((value) => value?.id === key);
      const entry = current[index];
      parts.push(entry?.title || entry?.text?.slice(0, 90) || `Step ${index + 1}`);
      current = entry;
    } else {
      parts.push(labels[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase()));
      current = current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined;
    }
  }
  return parts.join(" → ");
}
