import { z } from "zod";

const segment = z
  .string()
  .max(100)
  .refine((key) => !["__proto__", "prototype", "constructor"].includes(key));
const path = z.array(segment).min(1).max(12);
export const RecordPatchSchema = z.object({
  updatedAt: z.iso.datetime(),
  operations: z
    .array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("set"), path, value: z.unknown() }),
        z.object({ op: z.literal("remove"), path }),
        z.object({
          op: z.literal("splice"),
          path,
          start: z.number().int().nonnegative(),
          deleteCount: z.number().int().nonnegative(),
          items: z.array(z.unknown()),
        }),
      ]),
    )
    .max(50000),
});
type Operation = z.infer<typeof RecordPatchSchema>["operations"][number];
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Diff against the last saved version; inserts/removals are splices so adding one case never resends its siblings. */
export function recordPatch(before: unknown, after: unknown): Operation[] {
  const operations: Operation[] = [];
  const visit = (a: unknown, b: unknown, at: string[]) => {
    if (equal(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      const identity = (value: unknown) => (record(value) && typeof value.id === "string" ? value.id : value);
      if (a.length === b.length && a.every((value, index) => equal(identity(value), identity(b[index])))) {
        a.forEach((value, index) => visit(value, b[index], [...at, String(index)]));
      } else {
        let start = 0,
          end = 0;
        while (start < a.length && start < b.length && equal(identity(a[start]), identity(b[start]))) start++;
        while (end < a.length - start && end < b.length - start && equal(identity(a[a.length - 1 - end]), identity(b[b.length - 1 - end])))
          end++;
        for (let index = 0; index < start; index++) visit(a[index], b[index], [...at, String(index)]);
        operations.push({ op: "splice", path: at, start, deleteCount: a.length - start - end, items: b.slice(start, b.length - end) });
        for (let index = 0; index < end; index++)
          visit(a[a.length - end + index], b[b.length - end + index], [...at, String(b.length - end + index)]);
      }
    } else if (record(a) && record(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (key === "updatedAt" && !at.length) continue;
        if (b[key] === undefined) {
          if (a[key] !== undefined) operations.push({ op: "remove", path: [...at, key] });
        } else if (a[key] === undefined) operations.push({ op: "set", path: [...at, key], value: b[key] });
        else visit(a[key], b[key], [...at, key]);
      }
    } else operations.push({ op: "set", path: at, value: b });
  };
  visit(before, after, []);
  return operations;
}

/** Only existing own paths can be traversed. The caller validates the resulting domain aggregate before saving. */
export function applyRecordPatch<T>(input: T, operations: Operation[]): T {
  const result = structuredClone(input);
  for (const operation of operations) {
    if (!operation.path.length || operation.path.some((key) => ["__proto__", "constructor", "prototype"].includes(key)))
      throw new Error("Invalid patch path.");
    let parent: unknown = result;
    for (const key of operation.path.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) throw new Error("Invalid patch path.");
      parent = (parent as Record<string, unknown>)[key];
    }
    if (!parent || typeof parent !== "object") throw new Error("Invalid patch path.");
    const key = operation.path.at(-1)!;
    if (Array.isArray(parent) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= parent.length)) throw new Error("Invalid array path.");
    const object = parent as Record<string, unknown>;
    if (operation.op === "splice") {
      const target = object[key];
      if (!Array.isArray(target) || operation.start > target.length || operation.deleteCount > target.length - operation.start)
        throw new Error("Invalid splice.");
      target.splice(operation.start, operation.deleteCount, ...structuredClone(operation.items));
    } else if (operation.op === "remove") {
      if (Array.isArray(parent) || !Object.hasOwn(object, key)) throw new Error("Invalid removal.");
      delete object[key];
    } else object[key] = structuredClone(operation.value);
  }
  return result;
}
