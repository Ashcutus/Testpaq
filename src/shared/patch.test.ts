import { expect, it } from "vitest";
import { applyRecordPatch, recordPatch, RecordPatchSchema } from "./patch";

it("patches changed fields and inserts without resending unchanged large siblings", () => {
  const before = {
    updatedAt: "2026-10-01T12:00:00.000Z",
    cases: [
      { id: "a", title: "Before", text: "x".repeat(6 * 1024 * 1024) },
      { id: "b", title: "Other" },
    ],
  };
  const after = structuredClone(before);
  after.cases[0].title = "After";
  after.cases.splice(1, 1, { id: "c", title: "New" });
  const patch = recordPatch(before, after);
  expect(JSON.stringify(patch).length).toBeLessThan(500);
  expect(applyRecordPatch(before, patch)).toEqual(after);
  expect(before.cases[0].title).toBe("Before");
});

it("preserves edits in common array prefixes and suffixes around insertions and deletions", () => {
  const before = {
    values: [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ],
    optional: "remove",
  };
  const after = {
    values: [
      { id: "a", title: "Changed" },
      { id: "c", title: "Also changed" },
    ],
  };
  expect(applyRecordPatch(before, recordPatch(before, after))).toEqual(after);
});

it("rejects prototype traversal, missing paths and out-of-bounds array mutations", () => {
  expect(
    RecordPatchSchema.safeParse({
      updatedAt: "2026-10-01T12:00:00.000Z",
      operations: [{ op: "set", path: ["__proto__", "polluted"], value: true }],
    }).success,
  ).toBe(false);
  expect(() => applyRecordPatch({}, [{ op: "set", path: ["constructor", "prototype", "polluted"], value: true }])).toThrow();
  expect(() => applyRecordPatch({}, [{ op: "set", path: ["missing", "value"], value: true }])).toThrow();
  expect(() => applyRecordPatch({ values: [] }, [{ op: "splice", path: ["values"], start: 1, deleteCount: 0, items: [] }])).toThrow();
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
